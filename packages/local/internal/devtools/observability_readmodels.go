package devtools

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"time"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func observabilityStats(ctx context.Context, obs *observability.Service) store.StatsResult {
	runs, err := observabilityReadModelRuns(ctx, obs)
	if err != nil {
		return emptyStats()
	}

	var successCount, errorCount, runningCount int
	var totalDuration float64
	var completedCount int
	var totalCost float64
	var totalTokens int

	for _, run := range runs {
		headline := true
		switch normalizedStatus(run.Status) {
		case "ok":
			successCount++
			totalDuration += run.DurationMs
			completedCount++
		case "error":
			errorCount++
			totalDuration += run.DurationMs
			completedCount++
		case "running":
			runningCount++
		default:
			headline = false
		}
		if headline {
			metrics := rawMap(run.Metrics)
			totalCost += floatMetric(metrics, "costUsd", "cost")
			totalTokens += intMetric(metrics, "totalTokens", "tokens")
		}
	}

	totalExecutions := successCount + errorCount + runningCount
	var avgDuration float64
	if completedCount > 0 {
		avgDuration = math.Round(totalDuration / float64(completedCount))
	}
	var avgCost float64
	if totalExecutions > 0 {
		avgCost = totalCost / float64(totalExecutions)
	}
	var errorRate float64
	if totalExecutions > 0 {
		errorRate = float64(errorCount) / float64(totalExecutions)
	}

	return store.StatsResult{
		TotalExecutions: totalExecutions,
		SuccessCount:    successCount,
		ErrorCount:      errorCount,
		RunningCount:    runningCount,
		AvgDurationMs:   avgDuration,
		TotalCost:       totalCost,
		AvgCost:         avgCost,
		TotalTokens:     totalTokens,
		ErrorRate:       errorRate,
		MemoryByType:    map[string]store.MemoryTypeStats{},
	}
}

func observabilityCostReport(ctx context.Context, obs *observability.Service) (store.CostEventData, bool) {
	runs, err := observabilityReadModelRuns(ctx, obs)
	if err != nil {
		return store.CostEventData{}, false
	}

	total := 0.0
	latest := int64(0)
	byModel := map[string]any{}
	byPrompt := map[string]any{}
	for _, run := range runs {
		switch normalizedStatus(run.Status) {
		case "ok", "error", "running":
		default:
			continue
		}
		cost := floatMetric(rawMap(run.Metrics), "costUsd", "cost")
		if cost == 0 {
			continue
		}
		total += cost
		latest = max(latest, parseUnixMillis(run.StartedAt))
		addCostReportGroup(byModel, run.Model, cost)
		addCostReportGroup(byPrompt, run.PromptID, cost)
	}
	if total == 0 {
		return store.CostEventData{}, false
	}
	return store.CostEventData{
		Kind:      "report",
		Timestamp: latest,
		Report: map[string]any{
			"total":    map[string]any{"cost": total},
			"byModel":  byModel,
			"byPrompt": byPrompt,
		},
	}, true
}

func addCostReportGroup(group map[string]any, key string, cost float64) {
	if key == "" {
		return
	}
	entry, _ := group[key].(map[string]any)
	if entry == nil {
		entry = map[string]any{}
		group[key] = entry
	}
	entry["cost"] = floatMetric(entry, "cost") + cost
}

func observabilityTimeseries(ctx context.Context, obs *observability.Service, buckets int) []store.TimeseriesBucket {
	runs, err := observabilityReadModelRuns(ctx, obs)
	if err != nil || len(runs) == 0 || buckets <= 0 {
		return []store.TimeseriesBucket{}
	}

	eligible := make([]observability.RunSummary, 0, len(runs))
	for _, run := range runs {
		switch normalizedStatus(run.Status) {
		case "ok", "error", "running":
			eligible = append(eligible, run)
		}
	}
	if len(eligible) == 0 {
		return []store.TimeseriesBucket{}
	}

	minT := int64(math.MaxInt64)
	maxT := int64(math.MinInt64)
	for _, run := range eligible {
		started := parseUnixMillis(run.StartedAt)
		if started == 0 {
			continue
		}
		minT = min(minT, started)
		maxT = max(maxT, started)
	}
	if minT == int64(math.MaxInt64) {
		return []store.TimeseriesBucket{}
	}
	if minT == maxT {
		maxT = minT + 1
	}

	bucketSize := float64(maxT-minT) / float64(buckets)
	result := make([]store.TimeseriesBucket, buckets)
	durations := make([][]float64, buckets)
	for i := range result {
		result[i].T = minT + int64(float64(i)*bucketSize)
	}

	for _, run := range eligible {
		started := parseUnixMillis(run.StartedAt)
		if started == 0 {
			continue
		}
		idx := int(float64(started-minT) / bucketSize)
		idx = clampBucket(idx, buckets)
		result[idx].Executions++
		if normalizedStatus(run.Status) == "error" {
			result[idx].Errors++
		}
		result[idx].TotalCost += floatMetric(rawMap(run.Metrics), "costUsd", "cost")
		if status := normalizedStatus(run.Status); status == "ok" || status == "error" {
			durations[idx] = append(durations[idx], run.DurationMs)
		}
	}
	for i := range result {
		if len(durations[i]) == 0 {
			continue
		}
		var sum float64
		for _, duration := range durations[i] {
			sum += duration
		}
		result[i].AvgDurationMs = math.Round(sum / float64(len(durations[i])))
	}
	return result
}

func observabilityPromptBaselines(ctx context.Context, obs *observability.Service, window int) []store.PromptBaseline {
	runs, err := observabilityReadModelRuns(ctx, obs)
	if err != nil {
		return []store.PromptBaseline{}
	}
	byPrompt := make(map[string][]observability.RunSummary)
	for _, run := range runs {
		promptID := run.PromptID
		if promptID == "" {
			promptID = "unnamed"
		}
		byPrompt[promptID] = append(byPrompt[promptID], run)
	}

	result := make([]store.PromptBaseline, 0, len(byPrompt))
	for promptID, promptRuns := range byPrompt {
		recent := promptRuns
		if window > 0 && len(recent) > window {
			recent = recent[:window]
		}
		var duration float64
		var tokens int
		var cost float64
		for _, run := range recent {
			duration += run.DurationMs
			metrics := rawMap(run.Metrics)
			tokens += intMetric(metrics, "totalTokens", "tokens")
			cost += floatMetric(metrics, "costUsd", "cost")
		}
		count := len(recent)
		if count == 0 {
			continue
		}
		result = append(result, store.PromptBaseline{
			PromptID:      promptID,
			AvgDurationMs: math.Round(duration / float64(count)),
			AvgTokens:     math.Round(float64(tokens) / float64(count)),
			AvgCost:       cost / float64(count),
			TraceCount:    count,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].PromptID < result[j].PromptID
	})
	return result
}

func observabilityPromptUsage(ctx context.Context, obs *observability.Service) map[string]store.PromptUsageStat {
	runs, err := observabilityReadModelRuns(ctx, obs)
	if err != nil {
		return map[string]store.PromptUsageStat{}
	}
	type acc struct {
		count         int
		lastUsed      int64
		errorCount    int
		totalDuration float64
		completed     int
		totalCost     float64
	}
	grouped := make(map[string]*acc)
	for _, run := range runs {
		if run.PromptID == "" {
			continue
		}
		entry := grouped[run.PromptID]
		if entry == nil {
			entry = &acc{}
			grouped[run.PromptID] = entry
		}
		entry.count++
		entry.lastUsed = max(entry.lastUsed, parseUnixMillis(run.StartedAt))
		if normalizedStatus(run.Status) == "error" {
			entry.errorCount++
		}
		if run.DurationMs > 0 {
			entry.totalDuration += run.DurationMs
			entry.completed++
		}
		entry.totalCost += floatMetric(rawMap(run.Metrics), "costUsd", "cost")
	}

	result := make(map[string]store.PromptUsageStat, len(grouped))
	for promptID, entry := range grouped {
		var avgDuration float64
		if entry.completed > 0 {
			avgDuration = entry.totalDuration / float64(entry.completed)
		}
		result[promptID] = store.PromptUsageStat{
			Count:         entry.count,
			LastUsed:      entry.lastUsed,
			ErrorCount:    entry.errorCount,
			AvgDurationMs: avgDuration,
			TotalCost:     entry.totalCost,
		}
	}
	return result
}

func observabilityDroppedContexts(ctx context.Context, obs *observability.Service) map[string]store.DroppedContextFrequency {
	runs, err := observabilityReadModelRuns(ctx, obs)
	if err != nil {
		return map[string]store.DroppedContextFrequency{}
	}
	freq := make(map[string]store.DroppedContextFrequency)
	total := 0
	for _, run := range runs {
		dropped := droppedContextSources(rawMap(run.Attributes))
		if len(dropped) == 0 {
			detail, err := obs.RunDetail(ctx, run.RunID)
			if err == nil {
				for _, node := range flattenObservabilityDetailNodes(detail.Root) {
					dropped = append(dropped, droppedContextSources(rawMap(node.Attributes))...)
					for _, attached := range node.Details {
						dropped = append(dropped, droppedContextSources(rawMap(attached.Attributes))...)
					}
				}
			}
		}
		if len(dropped) == 0 {
			continue
		}
		total++
		for _, source := range dropped {
			entry := freq[source]
			entry.Count++
			freq[source] = entry
		}
	}
	for key, entry := range freq {
		entry.TotalTraces = total
		freq[key] = entry
	}
	return freq
}

func observabilitySessions(ctx context.Context, obs *observability.Service) []store.SessionInfo {
	runs, err := observabilityReadModelRuns(ctx, obs)
	if err != nil {
		return []store.SessionInfo{}
	}
	grouped := make(map[string]*store.SessionInfo)
	for _, run := range runs {
		sessionID := run.SessionID
		if sessionID == "" {
			sessionID = stringMetric(rawMap(run.Attributes), "sessionId", "sessionID")
		}
		if sessionID == "" {
			sessionID = "default"
		}
		started := parseUnixMillis(run.StartedAt)
		ended := parseUnixMillis(run.EndedAt)
		if ended == 0 && started > 0 {
			ended = started + int64(run.DurationMs)
		}
		entry := grouped[sessionID]
		if entry == nil {
			grouped[sessionID] = &store.SessionInfo{
				SessionID:      sessionID,
				TraceCount:     1,
				StartedAt:      started,
				LastActivityAt: ended,
			}
			continue
		}
		entry.TraceCount++
		if started > 0 && (entry.StartedAt == 0 || started < entry.StartedAt) {
			entry.StartedAt = started
		}
		if ended > entry.LastActivityAt {
			entry.LastActivityAt = ended
		}
	}

	result := make([]store.SessionInfo, 0, len(grouped))
	for _, entry := range grouped {
		result = append(result, *entry)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].LastActivityAt > result[j].LastActivityAt
	})
	return result
}

func observabilityTimeline(ctx context.Context, obs *observability.Service, sessionFilter string) []store.TimelineEvent {
	runs, err := observabilityReadModelRuns(ctx, obs)
	if err != nil {
		return []store.TimelineEvent{}
	}
	var events []store.TimelineEvent
	for _, run := range runs {
		attributes := rawMap(run.Attributes)
		sessionID := stringMetric(attributes, "sessionId", "sessionID")
		if sessionFilter != "" && sessionID != sessionFilter {
			continue
		}
		started := parseUnixMillis(run.StartedAt)
		events = append(events, store.TimelineEvent{
			Type:      "run",
			Timestamp: started,
			TraceID:   run.TraceID,
			SessionID: sessionID,
			Data: map[string]any{
				"runId":         run.RunID,
				"model":         run.Model,
				"provider":      run.Provider,
				"status":        run.Status,
				"promptId":      run.PromptID,
				"rootPrimitive": run.RootPrimitive,
			},
		})
		detail, err := obs.RunDetail(ctx, run.RunID)
		if err != nil {
			continue
		}
		seenEdges := map[string]bool{}
		for _, node := range flattenObservabilityDetailNodes(detail.Root) {
			if !(node.Virtual && node.SpanID == "") {
				events = append(events, store.TimelineEvent{
					Type:      "span",
					Timestamp: parseUnixMillis(node.StartedAt),
					TraceID:   node.TraceID,
					SessionID: sessionID,
					Data: map[string]any{
						"spanId":       node.SpanID,
						"parentSpanId": node.ParentSpanID,
						"family":       node.Family,
						"primitive":    node.Primitive,
						"name":         node.Display.Label,
						"status":       node.Status,
					},
				})
			}
			events = appendTimelineSpanEvents(events, node.Events, sessionID)
			events = appendTimelineEdges(events, node.Relations, sessionID, seenEdges)
			for _, attached := range node.Details {
				events = append(events, store.TimelineEvent{
					Type:      "span:detail",
					Timestamp: parseUnixMillis(attached.StartedAt),
					TraceID:   attached.TraceID,
					SessionID: sessionID,
					Data: map[string]any{
						"spanId":       attached.SpanID,
						"parentSpanId": attached.ParentSpanID,
						"family":       attached.Family,
						"primitive":    attached.Primitive,
						"name":         attached.Label,
						"status":       attached.Status,
						"ownerSpanId":  node.SpanID,
					},
				})
				events = appendTimelineSpanEvents(events, attached.Events, sessionID)
				events = appendTimelineEdges(events, attached.Relations, sessionID, seenEdges)
			}
		}
	}
	sort.Slice(events, func(i, j int) bool {
		return events[i].Timestamp < events[j].Timestamp
	})
	return events
}

func observabilityReadModelRuns(ctx context.Context, obs *observability.Service) ([]observability.RunSummary, error) {
	return obs.RunSummarySnapshot(ctx)
}

func flattenObservabilityDetailNodes(root observability.RunDetailNode) []observability.RunDetailNode {
	var nodes []observability.RunDetailNode
	var visit func(observability.RunDetailNode)
	visit = func(node observability.RunDetailNode) {
		nodes = append(nodes, node)
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(root)
	return nodes
}

func appendTimelineSpanEvents(events []store.TimelineEvent, spanEvents []observability.SpanEventSummary, sessionID string) []store.TimelineEvent {
	for _, event := range spanEvents {
		events = append(events, store.TimelineEvent{
			Type:      event.Name,
			Timestamp: parseUnixMillis(event.Timestamp),
			TraceID:   event.TraceID,
			SessionID: sessionID,
			Data: map[string]any{
				"eventId":    event.EventID,
				"spanId":     event.SpanID,
				"attributes": rawMap(event.Attributes),
			},
		})
	}
	return events
}

func appendTimelineEdges(events []store.TimelineEvent, edges []observability.EdgeSummary, sessionID string, seen map[string]bool) []store.TimelineEvent {
	for _, edge := range edges {
		if seen[edge.EdgeID] {
			continue
		}
		seen[edge.EdgeID] = true
		events = append(events, store.TimelineEvent{
			Type:      "edge:" + edge.EdgeType,
			Timestamp: parseUnixMillis(edge.CreatedAt),
			TraceID:   edge.TraceID,
			SessionID: sessionID,
			Data: map[string]any{
				"edgeId": edge.EdgeID,
				"from":   edge.From,
				"to":     edge.To,
			},
		})
	}
	return events
}

func emptyStats() store.StatsResult {
	return store.StatsResult{
		MemoryByType: map[string]store.MemoryTypeStats{},
	}
}

func normalizedStatus(status string) string {
	if normalized, ok := observability.NormalizeExecutionStatus(status); ok {
		return normalized
	}
	return status
}

func rawMap(raw json.RawMessage) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func intMetric(values map[string]any, keys ...string) int {
	for _, key := range keys {
		switch value := values[key].(type) {
		case float64:
			return int(value)
		case int:
			return value
		}
	}
	return 0
}

func floatMetric(values map[string]any, keys ...string) float64 {
	for _, key := range keys {
		switch value := values[key].(type) {
		case float64:
			return value
		case int:
			return float64(value)
		}
	}
	return 0
}

func stringMetric(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok {
			return value
		}
	}
	return ""
}

func droppedContextSources(attributes map[string]any) []string {
	raw, ok := attributes["droppedContexts"].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		switch value := item.(type) {
		case string:
			out = append(out, value)
		case map[string]any:
			if source, ok := value["source"].(string); ok && source != "" {
				out = append(out, source)
			}
		}
	}
	return out
}

func parseUnixMillis(value string) int64 {
	if value == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

func clampBucket(idx int, buckets int) int {
	if idx < 0 {
		return 0
	}
	if idx >= buckets {
		return buckets - 1
	}
	return idx
}
