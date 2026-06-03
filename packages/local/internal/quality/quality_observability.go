package quality

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type qualityObservabilityMetadata struct {
	feedbackByTrace       map[string][]string
	experimentsByTrace    map[string][]string
	scoresByTrace         map[string]qualityRunScoreSummary
	cassettePathsByTarget map[string][]string
}

func loadQualityObservabilityMetadata(dir string) (qualityObservabilityMetadata, error) {
	feedbackByTrace, err := qualityFeedbackIDsByTrace(dir)
	if err != nil {
		return qualityObservabilityMetadata{}, err
	}
	experimentsByTrace, err := qualityExperimentIDsByTrace(dir)
	if err != nil {
		return qualityObservabilityMetadata{}, err
	}
	scoresByTrace, err := qualityScoresByTrace(dir)
	if err != nil {
		return qualityObservabilityMetadata{}, err
	}
	cassettes, err := readQualityCassettes(filepath.Join(dir, "cassettes"))
	if err != nil {
		return qualityObservabilityMetadata{}, err
	}
	cassettePathsByTarget := map[string][]string{}
	for _, cassette := range cassettes {
		for _, entry := range cassette.Entries {
			if entry.TargetID == "" {
				continue
			}
			cassettePathsByTarget[entry.TargetID] = appendUniqueString(cassettePathsByTarget[entry.TargetID], cassette.Path)
		}
	}
	return qualityObservabilityMetadata{
		feedbackByTrace:       feedbackByTrace,
		experimentsByTrace:    experimentsByTrace,
		scoresByTrace:         scoresByTrace,
		cassettePathsByTarget: cassettePathsByTarget,
	}, nil
}

func buildQualityRunsFromObservability(ctx context.Context, obs *observability.Service, dir string) ([]qualityRunRecord, error) {
	return buildQualityRunsFromObservabilityWithOptions(ctx, obs, dir, observability.RunListOptions{})
}

func buildQualityRunsFromObservabilityWithOptions(ctx context.Context, obs *observability.Service, dir string, opts observability.RunListOptions) ([]qualityRunRecord, error) {
	metadata, err := loadQualityObservabilityMetadata(dir)
	if err != nil {
		return nil, err
	}
	summaries, err := obs.RunsWithOptions(ctx, opts)
	if err != nil {
		return nil, err
	}
	runIDs := make([]string, 0, len(summaries))
	for _, summary := range summaries {
		runIDs = append(runIDs, summary.RunID)
	}
	signals, err := obs.RunSignalsForRuns(ctx, runIDs)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			signals = map[string]observability.RunSignals{}
		} else {
			return nil, err
		}
	}
	runs := make([]qualityRunRecord, 0, len(summaries))
	for _, summary := range summaries {
		run := qualityRunFromObservabilitySummary(summary)
		run = applyObservabilityRunSignals(run, signals[summary.RunID])
		run = metadata.apply(run, summary)
		runs = append(runs, run)
	}
	return runs, nil
}

func (metadata qualityObservabilityMetadata) apply(run qualityRunRecord, summary observability.RunSummary) qualityRunRecord {
	run.FeedbackIDs = metadata.feedbackByTrace[summary.TraceID]
	if len(run.FeedbackIDs) == 0 {
		run.FeedbackIDs = metadata.feedbackByTrace[summary.RunID]
	}
	run.FeedbackCount = len(run.FeedbackIDs)
	run.ExperimentIDs = metadata.experimentsByTrace[summary.TraceID]
	if len(run.ExperimentIDs) == 0 {
		run.ExperimentIDs = metadata.experimentsByTrace[summary.RunID]
	}
	if score, ok := metadata.scoresByTrace[summary.TraceID]; ok {
		run.Score = score.Value
		run.ScoreName = score.Name
	} else if score, ok := metadata.scoresByTrace[summary.RunID]; ok {
		run.Score = score.Value
		run.ScoreName = score.Name
	}
	promptKey := ""
	if run.PromptID != nil {
		promptKey = *run.PromptID
	}
	for _, key := range []string{run.TargetID, promptKey, summary.RunID, summary.TraceID} {
		if key == "" {
			continue
		}
		run.CassettePaths = appendUniqueStrings(run.CassettePaths, metadata.cassettePathsByTarget[key]...)
	}
	if len(run.CassettePaths) > 0 {
		run.CassetteStatus = "linked"
	}
	return run
}

func applyObservabilityRunSignals(run qualityRunRecord, signals observability.RunSignals) qualityRunRecord {
	run.ToolCallCount = signals.ToolCallCount
	run.DiagnosticCount = signals.DiagnosticCount
	run.DiagnosticMaxSeverity = signals.DiagnosticMaxSeverity
	run.DiagnosticCodes = appendUniqueStrings(run.DiagnosticCodes, signals.DiagnosticCodes...)
	run.ToolErrorCount = signals.ToolErrorCount
	run.RepeatedToolName = signals.RepeatedToolName
	run.RepeatedToolCount = signals.RepeatedToolCount
	run.RetrievalIssueCount = signals.RetrievalIssueCount
	run.QualitySignalIssueCount = signals.QualitySignalIssueCount
	run.SuspensionSignalCount = signals.SuspensionSignalCount
	run.BlockedSignalCount = signals.BlockedSignalCount
	return run
}

func enrichQualityRunWithObservabilitySignals(run qualityRunRecord, detail observability.RunDetail) qualityRunRecord {
	toolCounts := map[string]int{}
	addDiagnostics := func(diagnostics []observability.RunDetailDiagnostic) {
		for _, diagnostic := range diagnostics {
			run.DiagnosticCount++
			if diagnostic.Code != "" {
				run.DiagnosticCodes = appendUniqueString(run.DiagnosticCodes, diagnostic.Code)
			}
		}
	}

	addDiagnostics(detail.Diagnostics)
	for _, node := range flattenRunDetailNodes(detail.Root) {
		addDiagnostics(node.Diagnostics)
		for _, attached := range node.Details {
			addDiagnostics(attached.Diagnostics)
		}

		if isToolRunDetailNode(node) {
			toolName := firstNonEmpty(node.ToolName, stringMetric(jsonObject(node.Attributes), "toolName"), node.Name, node.SpanID)
			run.ToolCallCount++
			toolCounts[toolName]++
			if isAttentionStatus(node.Status) || len(node.Error) > 0 {
				run.ToolErrorCount++
			}
		}
		if isRetrievalRunDetailNode(node) && (isAttentionStatus(node.Status) || retrievalReturnedZero(node)) {
			run.RetrievalIssueCount++
		}
		if isQualitySignalRunDetailNode(node) && isAttentionStatus(node.Status) {
			run.QualitySignalIssueCount++
		}
		if node.Status == "blocked" {
			run.BlockedSignalCount++
		}
		if node.Status == "suspended" || node.Primitive == "flow.suspension" {
			run.SuspensionSignalCount++
		}
	}

	for toolName, count := range toolCounts {
		if count > run.RepeatedToolCount {
			run.RepeatedToolName = toolName
			run.RepeatedToolCount = count
		}
	}
	return run
}

func isToolRunDetailNode(node observability.RunDetailNode) bool {
	return node.Family == "tool" || node.Primitive == "tool.call" || node.ToolName != ""
}

func isRetrievalRunDetailNode(node observability.RunDetailNode) bool {
	return node.Family == "retrieval" || strings.HasPrefix(node.Primitive, "retrieval.")
}

func isQualitySignalRunDetailNode(node observability.RunDetailNode) bool {
	switch node.Family {
	case "guardrail", "constraint", "scoring", "citation":
		return true
	}
	return strings.HasPrefix(node.Primitive, "guardrail.") ||
		strings.HasPrefix(node.Primitive, "constraint.") ||
		strings.HasPrefix(node.Primitive, "scoring.") ||
		strings.HasPrefix(node.Primitive, "citation.")
}

func isAttentionStatus(status string) bool {
	switch normalizeStatus(status) {
	case "error", "fail", "failed", "blocked", "incomplete", "stale":
		return true
	default:
		return false
	}
}

func retrievalReturnedZero(node observability.RunDetailNode) bool {
	if count, ok := numericAnyMetric(jsonObject(node.Attributes), "resultCount", "results", "hitCount", "hits", "count", "returned"); ok && count == 0 {
		return true
	}
	for _, artifact := range node.Artifacts {
		if artifact.Kind != "retrieval.hits" {
			continue
		}
		preview := jsonObject(artifact.Preview)
		if count, ok := numericAnyMetric(preview, "resultCount", "results", "hitCount", "hits", "count", "returned"); ok && count == 0 {
			return true
		}
		if hits, ok := preview["hits"].([]any); ok && len(hits) == 0 {
			return true
		}
	}
	return false
}

func numericAnyMetric(values map[string]any, keys ...string) (int, bool) {
	for _, key := range keys {
		value, ok := values[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int(typed), true
		case int:
			return typed, true
		case []any:
			return len(typed), true
		}
	}
	return 0, false
}

func toolCallCountFromObservabilityRunDetail(detail observability.RunDetail) int {
	count := 0
	for _, node := range flattenRunDetailNodes(detail.Root) {
		if node.Family == "tool" || node.Primitive == "tool.call" || node.ToolName != "" {
			count++
		}
	}
	return count
}

func buildQualityRunDetailFromObservability(ctx context.Context, obs *observability.Service, dir string, id string) (qualityRunDetailRecord, bool, error) {
	detail, found, err := observabilityRunDetailByRunOrTraceID(ctx, obs, id)
	if err != nil || !found {
		return qualityRunDetailRecord{}, found, err
	}
	metadata, err := loadQualityObservabilityMetadata(dir)
	if err != nil {
		return qualityRunDetailRecord{}, false, err
	}
	run := qualityRunFromObservabilitySummary(detail.Run)
	run = metadata.apply(run, detail.Run)
	run = enrichQualityRunWithObservabilitySignals(run, detail)
	return qualityRunDetailRecord{
		Tag:       "QualityRunDetail",
		Run:       run,
		Trace:     traceFromObservabilityRunDetail(detail),
		Events:    correlatedEventsFromObservabilityRunDetail(detail),
		Spans:     spansFromObservabilityRunDetail(detail),
		Narrative: narrativeFromObservabilityRunDetail(detail),
	}, true, nil
}

func buildQualityOverviewWithRuns(s *store.Store, dir string, runs []qualityRunRecord) (qualityOverviewRecord, error) {
	experiments, err := readQualityExperimentRecords(dir)
	if err != nil {
		return qualityOverviewRecord{}, err
	}
	suites, err := buildQualitySuites(dir)
	if err != nil {
		return qualityOverviewRecord{}, err
	}
	comparisons, err := readQualityRecords(dir, "comparisons")
	if err != nil {
		return qualityOverviewRecord{}, err
	}
	baselines, err := readQualityRecords(dir, "baselines")
	if err != nil {
		return qualityOverviewRecord{}, err
	}
	feedback, err := readQualityFeedbackRecords(dir)
	if err != nil {
		return qualityOverviewRecord{}, err
	}
	cassettes, err := readQualityCassettes(filepath.Join(dir, "cassettes"))
	if err != nil {
		return qualityOverviewRecord{}, err
	}
	insights, err := buildQualityInsightsFromRuns(dir, runs)
	if err != nil {
		return qualityOverviewRecord{}, err
	}

	feedbackNeedingReview := 0
	for _, item := range feedback {
		if item.Status == "" || item.Status == "new" {
			feedbackNeedingReview++
		}
	}
	cassetteIssues := 0
	for _, cassette := range cassettes {
		if cassette.MissingCount > 0 || cassette.MismatchCount > 0 {
			cassetteIssues++
		}
	}
	openInsightSeverityCounts := map[string]int{}
	for _, insight := range insights {
		if insight.Status == "" || insight.Status == "open" {
			openInsightSeverityCounts[insight.Severity]++
		}
	}

	overview := qualityOverviewRecord{
		Tag:                        "QualityOverview",
		RunCount:                   len(runs),
		SuiteCount:                 len(suites),
		ExperimentCount:            len(experiments),
		ComparisonCount:            len(comparisons),
		BaselineCount:              len(baselines),
		FeedbackCount:              len(feedback),
		FeedbackNeedingReviewCount: feedbackNeedingReview,
		CassetteCount:              len(cassettes),
		CassetteIssueCount:         cassetteIssues,
		InsightCount:               len(insights),
		TotalCost:                  qualityTotalCost(runs),
		PassRateHistory:            qualityPassRateHistory(experiments),
		OpenInsightsHistory:        qualityOpenInsightsHistory(insights),
		PassRateSpark:              qualityHourlyPassRateSpark(runs),
		CostSpark:                  qualityHourlyCostSpark(runs),
		LatencySpark:               qualityHourlyLatencySpark(runs),
		OpenInsightSeverityCounts:  openInsightSeverityCounts,
		RunTabCounts:               qualityRunTabCountsFromRuns(runs),
		RecentRuns:                 qualityRecentRuns(runs, 6),
	}
	if len(runs) > 0 {
		cost := (overview.TotalCost / float64(len(runs))) * 100
		overview.CostPer100Runs = &cost
	}
	if passRate := qualityPassRate(experiments); passRate != nil {
		overview.PassRate = passRate
	}
	if meanScore := qualityMeanRunScore(runs); meanScore != nil {
		overview.MeanScore = meanScore
	}
	if p50 := qualityP50Latency(runs); p50 != nil {
		overview.P50LatencyMs = p50
	}
	if p95 := qualityP95Latency(runs); p95 != nil {
		overview.P95LatencyMs = p95
	}
	if len(experiments) > 0 {
		latest := experiments[0]
		for _, experiment := range experiments[1:] {
			if qualityExperimentSortKey(experiment) > qualityExperimentSortKey(latest) {
				latest = experiment
			}
		}
		overview.LatestExperimentID = latest.ID
		passRate := passRateFromSummary(latest.Summary.Passed, latest.Summary.Total)
		overview.LatestExperimentPassRate = &passRate
		overview.LatestExperimentCompletedAt = nonEmptyString(latest.EndedAt, latest.StartedAt)
	}
	return overview, nil
}

func observabilityRunDetailByRunOrTraceID(ctx context.Context, obs *observability.Service, id string) (observability.RunDetail, bool, error) {
	detail, err := obs.RunDetail(ctx, id)
	if err == nil {
		return detail, true, nil
	}
	if !errors.Is(err, observability.ErrNotFound) {
		return observability.RunDetail{}, false, err
	}
	return observability.RunDetail{}, false, nil
}

func qualityRunFromObservabilitySummary(summary observability.RunSummary) qualityRunRecord {
	metrics := jsonObject(summary.Metrics)
	attrs := jsonObject(summary.Attributes)
	promptID := optionalStringPtr(summary.PromptID)
	cost := optionalFloatMetric(metrics, "costUsd", "cost")
	spanCount := maxInt(summary.SpanCount, 0)
	childCount := spanCount
	if childCount == 0 {
		childCount = 1
	}
	return qualityRunRecord{
		Tag:           "QualityRun",
		TraceID:       summary.RunID,
		TargetID:      firstNonEmpty(summary.PromptID, summary.Name, summary.RootPrimitive, summary.RunID),
		PromptID:      promptID,
		FlowID:        stringMetric(attrs, "flowId", "flowID"),
		ParentRunID:   stringMetric(attrs, "parentRunId", "parent_run_id"),
		RootPrimitive: summary.RootPrimitive,
		Kind:          qualityRunKindFromRootPrimitive(summary.RootPrimitive),
		Status:        normalizeStatus(summary.Status),
		StartedAt:     parseTimeMillis(summary.StartedAt),
		DurationMs:    optionalDuration(summary.DurationMs),
		Model:         summary.Model,
		Provider:      summary.Provider,
		Error:         jsonAny(summary.Error),
		Cost:          cost,
		TokenCount:    intMetric(metrics, "totalTokens"),
		SpanCount:     spanCount,
		ChildCount:    childCount,
		TraceCount:    childCount,
		SessionID:     stringMetric(attrs, "sessionId", "sessionID"),
		FeedbackIDs:   []string{},
		ExperimentIDs: []string{},
	}
}

func traceFromObservabilityRunDetail(detail observability.RunDetail) qualityTraceRecord {
	run := detail.Run
	metrics := jsonObject(run.Metrics)
	result := map[string]any{}
	if total := intMetric(metrics, "totalTokens"); total > 0 {
		result["usage"] = map[string]any{"totalTokens": total}
	}
	if cost, ok := floatMetric(metrics, "costUsd", "cost"); ok {
		result["cost"] = cost
	}
	if output, ok := artifactPreviewFromRunDetail(detail.Root, "output"); ok {
		result["output"] = output
	}
	resultJSON, _ := json.Marshal(result)
	return qualityTraceRecord{
		TraceID:    run.RunID,
		PromptID:   optionalStringPtr(run.PromptID),
		StartedAt:  parseTimeMillis(run.StartedAt),
		Input:      inputFromObservabilityRunDetail(detail),
		Model:      run.Model,
		Provider:   run.Provider,
		DurationMs: optionalDuration(run.DurationMs),
		Status:     normalizeStatus(run.Status),
		Result:     resultJSON,
		Error:      run.Error,
		SessionID:  stringMetric(jsonObject(run.Attributes), "sessionId", "sessionID"),
	}
}

func spansFromObservabilityRunDetail(detail observability.RunDetail) []qualityRunSpan {
	nodesByID := map[string]observability.RunDetailNode{}
	indexRunDetailNodes(detail.Root, nodesByID)
	spans := make([]qualityRunSpan, 0, len(detail.Rows))
	for _, row := range detail.Rows {
		node, ok := nodesByID[row.NodeID]
		if !ok || isVirtualRunDetailRoot(node) {
			continue
		}
		metrics := jsonObject(firstRawMessage(node.MetricBuckets.Total, node.MetricBuckets.Own, node.Metrics))
		attrs := stringAttributes(node.Attributes)
		cost := optionalFloatMetric(metrics, "costUsd", "cost")
		spans = append(spans, qualityRunSpan{
			ID:               node.SpanID,
			ParentID:         runDetailParentSpanID(row.ParentID, nodesByID),
			Kind:             firstNonEmpty(row.Display.Kind, node.Family),
			Op:               node.Primitive,
			Primitive:        firstNonEmpty(node.Primitive, node.Family),
			CompositionType:  compositionTypeFromPrimitive(node.Primitive),
			Name:             firstNonEmpty(row.Display.Label, node.Name, node.Primitive, node.SpanID),
			Status:           normalizeStatus(node.Status),
			StartedAt:        parseTimeMillis(row.Timing.StartedAt),
			EndedAt:          parseTimeMillis(row.Timing.EndedAt),
			DurationMs:       optionalDuration(row.Timing.DurationMs),
			TokenCount:       intMetric(metrics, "totalTokens"),
			Cost:             cost,
			Attributes:       attrs,
			Data:             node.Attributes,
			LinkedInsightIDs: []string{},
		})
	}
	return spans
}

func correlatedEventsFromObservabilityRunDetail(detail observability.RunDetail) []store.CorrelatedEvent {
	var events []store.CorrelatedEvent
	for _, node := range flattenRunDetailNodes(detail.Root) {
		events = appendRunDetailCorrelatedEvents(events, node.Events, node.Artifacts, node.Relations)
		for _, attached := range node.Details {
			events = appendRunDetailCorrelatedEvents(events, attached.Events, attached.Artifacts, attached.Relations)
		}
	}
	return events
}

func appendRunDetailCorrelatedEvents(events []store.CorrelatedEvent, spanEvents []observability.SpanEventSummary, artifacts []observability.ArtifactSummary, edges []observability.EdgeSummary) []store.CorrelatedEvent {
	for _, event := range spanEvents {
		data := map[string]any{"eventId": event.EventID, "spanId": event.SpanID, "name": event.Name, "attributes": jsonObject(event.Attributes)}
		events = append(events, store.CorrelatedEvent{ID: event.EventID, EventType: event.Name, Timestamp: parseTimeMillis(event.Timestamp), Data: data})
	}
	for _, artifact := range artifacts {
		data := map[string]any{"artifactId": artifact.ArtifactID, "spanId": artifact.SpanID, "kind": artifact.Kind, "preview": jsonAny(artifact.Preview)}
		events = append(events, store.CorrelatedEvent{ID: artifact.ArtifactID, EventType: "artifact:" + artifact.Kind, Timestamp: parseTimeMillis(artifact.CreatedAt), Data: data})
	}
	for _, edge := range edges {
		data := map[string]any{"edgeId": edge.EdgeID, "edgeType": edge.EdgeType, "from": edge.From, "to": edge.To, "attributes": jsonObject(edge.Attributes)}
		events = append(events, store.CorrelatedEvent{ID: edge.EdgeID, EventType: "edge:" + edge.EdgeType, Timestamp: parseTimeMillis(edge.CreatedAt), Data: data})
	}
	return events
}

func narrativeFromObservabilityRunDetail(detail observability.RunDetail) []qualityRunNarrativeEvent {
	start := parseTimeMillis(detail.Run.StartedAt)
	nodesByID := map[string]observability.RunDetailNode{}
	indexRunDetailNodes(detail.Root, nodesByID)
	events := make([]qualityRunNarrativeEvent, 0, len(detail.Rows))
	for _, row := range detail.Rows {
		node, ok := nodesByID[row.NodeID]
		if !ok || isVirtualRunDetailRoot(node) {
			continue
		}
		ts := parseTimeMillis(row.Timing.StartedAt)
		events = append(events, qualityRunNarrativeEvent{
			ID:        node.SpanID,
			Kind:      firstNonEmpty(row.Display.Kind, node.Family),
			Label:     firstNonEmpty(row.Display.Label, node.Name, node.Primitive),
			Timestamp: ts,
			OffsetMs:  ts - start,
			Data:      map[string]any{"primitive": node.Primitive, "status": node.Status, "attributes": jsonObject(node.Attributes)},
		})
	}
	for _, node := range flattenRunDetailNodes(detail.Root) {
		for _, attached := range node.Details {
			ts := parseTimeMillis(attached.Timing.StartedAt)
			events = append(events, qualityRunNarrativeEvent{
				ID:        attached.SpanID,
				Kind:      firstNonEmpty(attached.Kind, attached.Family),
				Label:     firstNonEmpty(attached.Label, attached.Name, attached.Primitive),
				Timestamp: ts,
				OffsetMs:  ts - start,
				Data:      map[string]any{"primitive": attached.Primitive, "status": attached.Status, "attributes": jsonObject(attached.Attributes), "attachedTo": node.SpanID},
			})
			events = appendNarrativeArtifactEvents(events, attached.Artifacts, attached.SpanSummary, start)
		}
		events = appendNarrativeArtifactEvents(events, node.Artifacts, node.SpanSummary, start)
		for _, event := range node.Events {
			ts := parseTimeMillis(event.Timestamp)
			events = append(events, qualityRunNarrativeEvent{
				ID:        event.EventID,
				Kind:      "event",
				Label:     event.Name,
				Timestamp: ts,
				OffsetMs:  ts - start,
				Data:      jsonObject(event.Attributes),
			})
		}
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].Timestamp < events[j].Timestamp })
	return events
}

func appendNarrativeArtifactEvents(events []qualityRunNarrativeEvent, artifacts []observability.ArtifactSummary, owner observability.SpanSummary, start int64) []qualityRunNarrativeEvent {
	for _, artifact := range artifacts {
		kind, label, data := narrativeArtifactEventData(artifact, owner)
		if kind == "" {
			continue
		}
		ts := parseTimeMillis(artifact.CreatedAt)
		events = append(events, qualityRunNarrativeEvent{
			ID:        artifact.ArtifactID,
			Kind:      kind,
			Label:     label,
			Timestamp: ts,
			OffsetMs:  ts - start,
			Data:      data,
		})
	}
	return events
}

func narrativeArtifactEventData(artifact observability.ArtifactSummary, owner observability.SpanSummary) (string, string, map[string]any) {
	preview := jsonAny(artifact.Preview)
	attrs := jsonObject(artifact.Attributes)
	actor := firstNonEmpty(owner.ToolName, stringMetric(attrs, "toolName", "tool_name"), owner.Name, owner.Primitive)
	data := map[string]any{
		"actor": actor,
		"body":  preview,
		"meta":  narrativeMetricMeta(artifact.Kind, owner),
	}
	if owner.Primitive != "" {
		data["primitive"] = owner.Primitive
	}

	switch artifact.Kind {
	case "input", "messages", "prompt", "system":
		if text := narrativeTextFromPreview(preview); text != "" {
			data["text"] = text
		}
		return "input", artifact.Kind, data
	case "output", "stream.timeline":
		if text := narrativeTextFromPreview(preview); text != "" {
			data["text"] = text
		}
		return "output", artifact.Kind, data
	case "tool.args", "tool.request", "tool.result":
		return "tool", firstNonEmpty(actor, artifact.Kind), data
	case "retrieval.hits":
		if detail := narrativeHitCountDetail(preview); detail != "" {
			data["detail"] = detail
		}
		if query := narrativeStringField(preview, "query"); query != "" {
			data["text"] = query
		}
		return "retrieval", "retrieval hits", data
	case "score.report":
		if detail := narrativeStringField(preview, "reasoning", "reasoningPreview", "rationale"); detail != "" {
			data["detail"] = detail
		}
		return "score", "score report", data
	case "citation.report":
		if detail := narrativeCitationDetail(preview); detail != "" {
			data["detail"] = detail
		}
		return "citation", "citation report", data
	case "memory.snapshot":
		if detail := narrativeMemoryDetail(preview); detail != "" {
			data["detail"] = detail
		}
		return "memory", "memory snapshot", data
	case "handoff.payload":
		return "handoff", "handoff payload", data
	case "constraint.report", "guardrail.report":
		return "safety", artifact.Kind, data
	case "error.stack", "error.raw":
		if text := narrativeTextFromPreview(preview); text != "" {
			data["text"] = text
		}
		return "error", artifact.Kind, data
	default:
		return "", "", nil
	}
}

func narrativeMetricMeta(kind string, owner observability.SpanSummary) string {
	parts := []string{kind}
	metrics := jsonObject(owner.Metrics)
	if tokens := firstPositiveIntMetric(metrics, "totalTokens", "tokenCount", "tokens"); tokens > 0 {
		parts = append(parts, fmt.Sprintf("%d tokens", tokens))
	}
	if cost := optionalFloatMetric(metrics, "costUsd", "cost"); cost != nil && *cost > 0 {
		parts = append(parts, fmt.Sprintf("$%.4f", *cost))
	}
	return strings.Join(parts, " | ")
}

func firstPositiveIntMetric(metrics map[string]any, keys ...string) int {
	for _, key := range keys {
		if value := intMetric(metrics, key); value > 0 {
			return value
		}
	}
	return 0
}

func narrativeTextFromPreview(preview any) string {
	switch value := preview.(type) {
	case string:
		return value
	case map[string]any:
		return firstNonEmpty(
			stringMetric(value, "text"),
			stringMetric(value, "output"),
			stringMetric(value, "answer"),
			stringMetric(value, "content"),
		)
	default:
		return ""
	}
}

func narrativeStringField(preview any, keys ...string) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	return stringMetric(obj, keys...)
}

func narrativeHitCountDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	count, found := numericAnyMetric(obj, "returned", "resultCount", "hitCount", "count")
	if !found {
		if hits, ok := obj["hits"].([]any); ok {
			count = len(hits)
			found = true
		}
	}
	if !found {
		return ""
	}
	if count == 1 {
		return "1 hit"
	}
	return fmt.Sprintf("%d hits", count)
}

func narrativeCitationDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	if note := stringMetric(obj, "note", "summary"); note != "" {
		return note
	}
	markers, ok := obj["markers"].([]any)
	if !ok {
		return ""
	}
	if len(markers) == 1 {
		return "1 marker"
	}
	return fmt.Sprintf("%d markers", len(markers))
}

func narrativeMemoryDetail(preview any) string {
	obj, ok := preview.(map[string]any)
	if !ok {
		return ""
	}
	memoryType := firstNonEmpty(stringMetric(obj, "memoryType"), stringMetric(obj, "blockKind"), "memory")
	blocks, ok := obj["blocks"].([]any)
	if !ok {
		return memoryType
	}
	if len(blocks) == 1 {
		return memoryType + " | 1 block"
	}
	return fmt.Sprintf("%s | %d blocks", memoryType, len(blocks))
}

func inputFromObservabilityRunDetail(detail observability.RunDetail) map[string]any {
	for _, kind := range []string{"input", "messages", "prompt"} {
		if preview, ok := artifactPreviewFromRunDetail(detail.Root, kind); ok {
			return preview
		}
	}
	return map[string]any{}
}

func artifactPreviewFromRunDetail(root observability.RunDetailNode, kind string) (map[string]any, bool) {
	for _, node := range flattenRunDetailNodes(root) {
		if preview, ok := artifactPreviewFromSummaries(node.Artifacts, kind); ok {
			return preview, true
		}
		for _, detail := range node.Details {
			if preview, ok := artifactPreviewFromSummaries(detail.Artifacts, kind); ok {
				return preview, true
			}
		}
	}
	return nil, false
}

func artifactPreviewFromSummaries(artifacts []observability.ArtifactSummary, kind string) (map[string]any, bool) {
	for _, artifact := range artifacts {
		if artifact.Kind != kind {
			continue
		}
		preview := jsonObject(artifact.Preview)
		if len(preview) > 0 {
			return preview, true
		}
	}
	return nil, false
}

func flattenRunDetailNodes(root observability.RunDetailNode) []observability.RunDetailNode {
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

func indexRunDetailNodes(node observability.RunDetailNode, out map[string]observability.RunDetailNode) {
	out[node.ID] = node
	for _, child := range node.Children {
		indexRunDetailNodes(child, out)
	}
}

func runDetailParentSpanID(parentID string, nodesByID map[string]observability.RunDetailNode) string {
	if parentID == "" {
		return ""
	}
	parent, ok := nodesByID[parentID]
	if !ok {
		return ""
	}
	return parent.SpanID
}

func isVirtualRunDetailRoot(node observability.RunDetailNode) bool {
	return node.Virtual && node.SpanID == ""
}

func firstRawMessage(values ...json.RawMessage) json.RawMessage {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

func compositionTypeFromPrimitive(primitive string) string {
	switch primitive {
	case "composition.pipeline":
		return "pipeline"
	case "composition.parallel":
		return "parallel"
	case "composition.consensus":
		return "consensus"
	case "composition.swarm":
		return "swarm"
	default:
		return ""
	}
}

func jsonObject(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	return obj
}

func jsonAny(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func stringAttributes(raw json.RawMessage) map[string]string {
	obj := jsonObject(raw)
	if len(obj) == 0 {
		return nil
	}
	out := make(map[string]string, len(obj))
	for key, value := range obj {
		switch typed := value.(type) {
		case string:
			out[key] = typed
		case bool, float64, int:
			out[key] = fmt.Sprint(typed)
		}
	}
	return out
}

func intMetric(metrics map[string]any, key string) int {
	value, ok := metrics[key]
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	default:
		return 0
	}
}

func floatMetric(metrics map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		value, ok := metrics[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed, true
		case int:
			return float64(typed), true
		}
	}
	return 0, false
}

func optionalFloatMetric(metrics map[string]any, keys ...string) *float64 {
	if value, ok := floatMetric(metrics, keys...); ok {
		return &value
	}
	return nil
}

func stringMetric(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key].(string); ok {
			return value
		}
	}
	return ""
}

func optionalStringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func optionalDuration(value float64) *float64 {
	if value <= 0 {
		return nil
	}
	return &value
}

func parseTimeMillis(value string) int64 {
	if value == "" {
		return 0
	}
	ts, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return ts.UnixMilli()
}

func normalizeStatus(status string) string {
	switch status {
	case "success", "passed":
		return "ok"
	case "error":
		return "error"
	default:
		return status
	}
}

func qualityRunKindFromRootPrimitive(rootPrimitive string) string {
	switch {
	case strings.HasPrefix(rootPrimitive, "composition."):
		return "composition"
	case strings.HasPrefix(rootPrimitive, "agent."):
		return "agent"
	case strings.HasPrefix(rootPrimitive, "flow."):
		return "flow"
	case strings.HasPrefix(rootPrimitive, "generation."):
		return "generation"
	case strings.HasPrefix(rootPrimitive, "retrieval."):
		return "retrieval"
	case strings.HasPrefix(rootPrimitive, "eval."), strings.HasPrefix(rootPrimitive, "scoring."):
		return "eval"
	case rootPrimitive == "":
		return ""
	default:
		return "operation"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
