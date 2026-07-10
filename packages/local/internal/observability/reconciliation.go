package observability

import (
	"encoding/json"
	"time"
)

func reconciledPresentationGraph(graph Graph) Graph {
	return reconciledPresentationGraphAt(graph, time.Now())
}

func reconciledPresentationGraphAt(graph Graph, now time.Time) Graph {
	graph.Spans = reconcileConvexBoundarySpans(graph.Spans, graph.Events)
	graph.Spans = reconcileExpiredConvexBoundaryLeasesAt(graph.Spans, graph.Events, now)
	graph.Spans = reconcileRunningDescendantsFromTerminalAncestors(graph.Spans, graph.Events, graph.Artifacts)
	graph.Spans = reconcileExpiredOperationDeadlinesAt(graph.Spans, graph.Events, now)
	graph = propagateReconciledSpanIncompleteness(graph)
	graph = reconcileTerminalParentSpans(graph)
	return stalePresentationGraphAt(graph, now)
}

func reconcileConvexBoundarySpans(spans []SpanSummary, events []SpanEventSummary) []SpanSummary {
	completions := make(map[string]SpanEventSummary)
	for _, event := range events {
		if event.Name != "runtime.convex.boundary.completed" && event.Name != "runtime.convex.boundary.failed" {
			continue
		}
		if event.SpanID == "" {
			continue
		}
		if existing, ok := completions[event.SpanID]; ok && existing.Timestamp >= event.Timestamp {
			continue
		}
		completions[event.SpanID] = event
	}
	if len(completions) == 0 {
		return spans
	}

	reconciled := append([]SpanSummary(nil), spans...)
	for i := range reconciled {
		span := &reconciled[i]
		if span.EndedAt != "" || span.Status != "running" {
			continue
		}
		if !isConvexBoundarySpan(*span) {
			continue
		}
		completion, ok := completions[span.SpanID]
		if !ok {
			continue
		}
		span.EndedAt = completion.Timestamp
		span.Status = convexBoundaryCompletionStatus(completion)
		span.DurationMs = durationBetweenTimestamps(span.StartedAt, completion.Timestamp)
		span.Attributes = mergePresentationAttributes(span.Attributes, map[string]any{
			"reconciledFrom": "runtime.convex.boundary",
			"boundaryEvent":  completion.Name,
		})
	}
	return reconciled
}

func isConvexBoundarySpan(span SpanSummary) bool {
	return span.Primitive == "runtime.convex.action" || span.Primitive == "runtime.convex.schedule"
}

func convexBoundaryCompletionStatus(event SpanEventSummary) string {
	if event.Name == "runtime.convex.boundary.failed" {
		return "error"
	}
	var decoded struct {
		Status string `json:"status"`
	}
	if len(event.Attributes) > 0 && json.Unmarshal(event.Attributes, &decoded) == nil {
		switch decoded.Status {
		case "ok", "error", "cancelled", "suspended", "skipped":
			return decoded.Status
		}
	}
	return "ok"
}

type convexBoundaryLease struct {
	LeaseExpiresAt string
	EventName      string
}

func reconcileExpiredConvexBoundaryLeases(spans []SpanSummary, events []SpanEventSummary) []SpanSummary {
	return reconcileExpiredConvexBoundaryLeasesAt(spans, events, time.Now())
}

func reconcileExpiredConvexBoundaryLeasesAt(spans []SpanSummary, events []SpanEventSummary, now time.Time) []SpanSummary {
	leases := convexBoundaryLeasesBySpan(events)
	if len(leases) == 0 {
		return spans
	}
	completed := convexBoundaryTerminalSpans(events)
	reconciled := append([]SpanSummary(nil), spans...)
	for i := range reconciled {
		span := &reconciled[i]
		if span.EndedAt != "" || span.Status != "running" || !isConvexBoundarySpan(*span) {
			continue
		}
		if _, ok := completed[span.SpanID]; ok {
			continue
		}
		lease, ok := leases[span.SpanID]
		if !ok {
			continue
		}
		expiresAt, err := time.Parse(time.RFC3339Nano, lease.LeaseExpiresAt)
		if err != nil || now.Before(expiresAt) {
			continue
		}
		span.EndedAt = expiresAt.Format(time.RFC3339Nano)
		span.Status = "stale"
		span.DurationMs = durationBetweenTimestamps(span.StartedAt, span.EndedAt)
		span.Attributes = mergePresentationAttributes(span.Attributes, map[string]any{
			"reconciledFrom": "runtime.convex.boundary.lease",
			"boundaryEvent":  lease.EventName,
			"leaseExpiresAt": span.EndedAt,
		})
	}
	return reconciled
}

func convexBoundaryTerminalSpans(events []SpanEventSummary) map[string]struct{} {
	completed := make(map[string]struct{})
	for _, event := range events {
		if event.Name != "runtime.convex.boundary.completed" && event.Name != "runtime.convex.boundary.failed" {
			continue
		}
		if event.SpanID != "" {
			completed[event.SpanID] = struct{}{}
		}
	}
	return completed
}

func convexBoundaryLeasesBySpan(events []SpanEventSummary) map[string]convexBoundaryLease {
	leases := make(map[string]convexBoundaryLease)
	for _, event := range events {
		if event.Name != "runtime.convex.boundary.requested" && event.Name != "runtime.convex.boundary.received" {
			continue
		}
		if event.SpanID == "" {
			continue
		}
		var decoded struct {
			LeaseExpiresAt string `json:"leaseExpiresAt"`
		}
		if len(event.Attributes) == 0 || json.Unmarshal(event.Attributes, &decoded) != nil || decoded.LeaseExpiresAt == "" {
			continue
		}
		if existing, ok := leases[event.SpanID]; ok && existing.LeaseExpiresAt >= decoded.LeaseExpiresAt {
			continue
		}
		leases[event.SpanID] = convexBoundaryLease{LeaseExpiresAt: decoded.LeaseExpiresAt, EventName: event.Name}
	}
	return leases
}

type operationDeadline struct {
	DeadlineAt string
	TimeoutMs  float64
}

func reconcileExpiredOperationDeadlines(spans []SpanSummary, events []SpanEventSummary) []SpanSummary {
	return reconcileExpiredOperationDeadlinesAt(spans, events, time.Now())
}

func reconcileExpiredOperationDeadlinesAt(spans []SpanSummary, events []SpanEventSummary, now time.Time) []SpanSummary {
	deadlines := operationDeadlinesBySpan(spans, events)
	if len(deadlines) == 0 {
		return spans
	}
	reconciled := append([]SpanSummary(nil), spans...)
	for i := range reconciled {
		span := &reconciled[i]
		if span.EndedAt != "" || span.Status != "running" {
			continue
		}
		deadline, ok := deadlines[span.SpanID]
		if !ok {
			continue
		}
		deadlineAt, err := time.Parse(time.RFC3339Nano, deadline.DeadlineAt)
		if err != nil || now.Before(deadlineAt) {
			continue
		}
		span.EndedAt = deadlineAt.Format(time.RFC3339Nano)
		span.Status = "incomplete"
		span.DurationMs = durationBetweenTimestamps(span.StartedAt, span.EndedAt)
		span.Attributes = mergePresentationAttributes(span.Attributes, map[string]any{
			"reconciledFrom": "operation.deadline",
			"timeoutMs":      deadline.TimeoutMs,
			"deadlineAt":     span.EndedAt,
		})
	}
	return reconciled
}

func operationDeadlinesBySpan(spans []SpanSummary, events []SpanEventSummary) map[string]operationDeadline {
	deadlines := make(map[string]operationDeadline)
	for _, span := range spans {
		deadline, ok := operationDeadlineFromSpan(span)
		if ok {
			deadlines[span.SpanID] = deadline
		}
	}
	for _, event := range events {
		if event.Name != "operation.deadline" || event.SpanID == "" {
			continue
		}
		var decoded struct {
			DeadlineAt string  `json:"deadlineAt"`
			TimeoutMs  float64 `json:"timeoutMs"`
		}
		if len(event.Attributes) == 0 || json.Unmarshal(event.Attributes, &decoded) != nil || decoded.DeadlineAt == "" {
			continue
		}
		if existing, ok := deadlines[event.SpanID]; ok && existing.DeadlineAt >= decoded.DeadlineAt {
			continue
		}
		deadlines[event.SpanID] = operationDeadline{DeadlineAt: decoded.DeadlineAt, TimeoutMs: decoded.TimeoutMs}
	}
	return deadlines
}

func operationDeadlineFromSpan(span SpanSummary) (operationDeadline, bool) {
	var decoded struct {
		DeadlineAt string  `json:"deadlineAt"`
		TimeoutMs  float64 `json:"timeoutMs"`
	}
	if len(span.Attributes) == 0 || json.Unmarshal(span.Attributes, &decoded) != nil {
		return operationDeadline{}, false
	}
	if decoded.DeadlineAt != "" {
		return operationDeadline{DeadlineAt: decoded.DeadlineAt, TimeoutMs: decoded.TimeoutMs}, true
	}
	if decoded.TimeoutMs <= 0 || span.StartedAt == "" {
		return operationDeadline{}, false
	}
	startedAt, err := time.Parse(time.RFC3339Nano, span.StartedAt)
	if err != nil {
		return operationDeadline{}, false
	}
	return operationDeadline{
		DeadlineAt: startedAt.Add(time.Duration(decoded.TimeoutMs) * time.Millisecond).Format(time.RFC3339Nano),
		TimeoutMs:  decoded.TimeoutMs,
	}, true
}

func reconcileRunningDescendantsFromTerminalAncestors(spans []SpanSummary, events []SpanEventSummary, artifacts []ArtifactSummary) []SpanSummary {
	if len(spans) == 0 {
		return spans
	}
	spanIndex := make(map[string]int, len(spans))
	for i, span := range spans {
		spanIndex[span.SpanID] = i
	}

	completionEvidence := spansWithCompletionEvidence(events, artifacts)
	reconciled := append([]SpanSummary(nil), spans...)
	for i := range reconciled {
		span := &reconciled[i]
		if span.EndedAt != "" || span.Status != "running" {
			continue
		}
		ancestor, ok := nearestTerminalAncestor(reconciled, spanIndex, span.ParentSpanID)
		if !ok {
			continue
		}
		if !timestampAtOrBefore(span.StartedAt, ancestor.EndedAt) {
			continue
		}
		status := ancestor.Status
		if _, ok := completionEvidence[span.SpanID]; ok {
			status = "ok"
		}
		span.EndedAt = ancestor.EndedAt
		span.Status = status
		span.DurationMs = durationBetweenTimestamps(span.StartedAt, span.EndedAt)
		span.Attributes = mergePresentationAttributes(span.Attributes, map[string]any{
			"reconciledFrom": "terminal.ancestor",
			"ancestorSpanId": ancestor.SpanID,
		})
	}
	return reconciled
}

func spansWithCompletionEvidence(events []SpanEventSummary, artifacts []ArtifactSummary) map[string]struct{} {
	evidence := make(map[string]struct{})
	for _, event := range events {
		if event.SpanID == "" {
			continue
		}
		switch event.Name {
		case "usage.observed", "generation.finished", "tool.result":
			evidence[event.SpanID] = struct{}{}
		}
	}
	for _, artifact := range artifacts {
		if artifact.SpanID == "" {
			continue
		}
		switch artifact.Kind {
		case "output", "tool.result":
			evidence[artifact.SpanID] = struct{}{}
		}
	}
	return evidence
}

func nearestTerminalAncestor(spans []SpanSummary, spanIndex map[string]int, parentSpanID string) (SpanSummary, bool) {
	currentID := parentSpanID
	for currentID != "" {
		idx, ok := spanIndex[currentID]
		if !ok {
			return SpanSummary{}, false
		}
		ancestor := spans[idx]
		if ancestor.EndedAt != "" && ancestor.Status != "" && ancestor.Status != "running" {
			return ancestor, true
		}
		currentID = ancestor.ParentSpanID
	}
	return SpanSummary{}, false
}

func timestampAtOrBefore(value, boundary string) bool {
	if value == "" || boundary == "" {
		return false
	}
	valueTime, valueErr := time.Parse(time.RFC3339Nano, value)
	boundaryTime, boundaryErr := time.Parse(time.RFC3339Nano, boundary)
	if valueErr != nil || boundaryErr != nil {
		return value <= boundary
	}
	return valueTime.Before(boundaryTime) || valueTime.Equal(boundaryTime)
}

func propagateReconciledSpanIncompleteness(graph Graph) Graph {
	incompleteEndsBySpan := make(map[string]string)
	for _, span := range graph.Spans {
		if span.Status == "incomplete" && span.EndedAt != "" && presentationReconciledFrom(span.Attributes) == "operation.deadline" {
			incompleteEndsBySpan[span.SpanID] = span.EndedAt
		}
	}
	if len(incompleteEndsBySpan) == 0 {
		return graph
	}

	spanIndex := make(map[string]int, len(graph.Spans))
	for i, span := range graph.Spans {
		spanIndex[span.SpanID] = i
	}
	latestRunEnd := ""
	for causeSpanID, endedAt := range incompleteEndsBySpan {
		latestRunEnd = laterTimestamp(latestRunEnd, endedAt)
		currentID := graph.Spans[spanIndex[causeSpanID]].ParentSpanID
		for currentID != "" {
			idx, ok := spanIndex[currentID]
			if !ok {
				break
			}
			span := &graph.Spans[idx]
			if span.EndedAt == "" && span.Status == "running" {
				span.EndedAt = endedAt
				span.Status = "incomplete"
				span.DurationMs = durationBetweenTimestamps(span.StartedAt, span.EndedAt)
				span.Attributes = mergePresentationAttributes(span.Attributes, map[string]any{
					"reconciledFrom": "descendant.operation.deadline",
					"causeSpanId":    causeSpanID,
				})
			}
			currentID = span.ParentSpanID
		}
	}
	if graph.Run.Status == "running" && graph.Run.EndedAt == "" && latestRunEnd != "" {
		graph.Run.EndedAt = latestRunEnd
		graph.Run.Status = "incomplete"
		graph.Run.DurationMs = durationBetweenTimestamps(graph.Run.StartedAt, latestRunEnd)
		graph.Run.Attributes = mergePresentationAttributes(graph.Run.Attributes, map[string]any{
			"reconciledFrom": "descendant.operation.deadline",
		})
	}
	return graph
}

func reconcileTerminalParentSpans(graph Graph) Graph {
	if len(graph.Spans) == 0 {
		return graph
	}

	spanIndex := make(map[string]int, len(graph.Spans))
	childrenByParent := make(map[string][]string)
	for i, span := range graph.Spans {
		spanIndex[span.SpanID] = i
		childrenByParent[span.ParentSpanID] = append(childrenByParent[span.ParentSpanID], span.SpanID)
	}

	changed := true
	for changed {
		changed = false
		for i := range graph.Spans {
			span := &graph.Spans[i]
			if span.EndedAt != "" || span.Status != "running" {
				continue
			}
			children := childrenByParent[span.SpanID]
			if len(children) == 0 {
				continue
			}
			endedAt, status, ok := terminalChildrenSummary(graph.Spans, spanIndex, children)
			if !ok {
				continue
			}
			span.EndedAt = endedAt
			span.Status = status
			span.DurationMs = durationBetweenTimestamps(span.StartedAt, span.EndedAt)
			span.Attributes = mergePresentationAttributes(span.Attributes, map[string]any{
				"reconciledFrom": "terminal.children",
			})
			changed = true
		}
	}

	if graph.Run.EndedAt == "" && graph.Run.Status == "running" {
		roots := childrenByParent[""]
		if len(roots) > 0 {
			if endedAt, status, ok := terminalChildrenSummary(graph.Spans, spanIndex, roots); ok {
				graph.Run.EndedAt = endedAt
				graph.Run.Status = status
				graph.Run.DurationMs = durationBetweenTimestamps(graph.Run.StartedAt, graph.Run.EndedAt)
				graph.Run.Attributes = mergePresentationAttributes(graph.Run.Attributes, map[string]any{
					"reconciledFrom": "terminal.children",
				})
			}
		}
	}

	return graph
}

func terminalChildrenSummary(spans []SpanSummary, spanIndex map[string]int, children []string) (string, string, bool) {
	endedAt := ""
	status := "ok"
	for _, childID := range children {
		idx, ok := spanIndex[childID]
		if !ok {
			return "", "", false
		}
		child := spans[idx]
		if child.EndedAt == "" || child.Status == "running" {
			return "", "", false
		}
		endedAt = laterTimestamp(endedAt, child.EndedAt)
		status = aggregateTerminalStatus(status, child.Status)
	}
	if endedAt == "" {
		return "", "", false
	}
	return endedAt, status, true
}

func aggregateTerminalStatus(current, next string) string {
	rank := map[string]int{
		"ok":         0,
		"skipped":    1,
		"cancelled":  2,
		"suspended":  3,
		"incomplete": 4,
		"stale":      5,
		"error":      6,
	}
	if rank[next] > rank[current] {
		return next
	}
	return current
}

func presentationReconciledFrom(raw json.RawMessage) string {
	var decoded struct {
		Diagnostics struct {
			ReconciledFrom string `json:"reconciledFrom"`
		} `json:"diagnostics"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &decoded) != nil {
		return ""
	}
	return decoded.Diagnostics.ReconciledFrom
}

func errorRawMessage(message, name string) json.RawMessage {
	encoded, err := json.Marshal(map[string]any{"message": message, "name": name})
	if err != nil {
		return nil
	}
	return encoded
}

func laterTimestamp(left, right string) string {
	if left == "" {
		return right
	}
	if right == "" {
		return left
	}
	leftTime, leftErr := time.Parse(time.RFC3339Nano, left)
	rightTime, rightErr := time.Parse(time.RFC3339Nano, right)
	if leftErr != nil {
		return right
	}
	if rightErr != nil || leftTime.After(rightTime) {
		return left
	}
	return right
}

func mergePresentationAttributes(raw json.RawMessage, values map[string]any) json.RawMessage {
	merged := make(map[string]any)
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &merged)
	}
	diagnostics, _ := merged["diagnostics"].(map[string]any)
	if diagnostics == nil {
		diagnostics = make(map[string]any)
	}
	for key, value := range values {
		diagnostics[key] = value
	}
	merged["diagnostics"] = diagnostics
	encoded, err := json.Marshal(merged)
	if err != nil {
		return raw
	}
	return encoded
}

func durationBetweenTimestamps(startedAt, endedAt string) float64 {
	start, err := time.Parse(time.RFC3339Nano, startedAt)
	if err != nil {
		return 0
	}
	end, err := time.Parse(time.RFC3339Nano, endedAt)
	if err != nil {
		return 0
	}
	duration := end.Sub(start)
	if duration < 0 {
		return 0
	}
	return float64(duration.Milliseconds())
}

func stalePresentationGraph(graph Graph) Graph {
	return stalePresentationGraphAt(graph, time.Now())
}

func stalePresentationGraphAt(graph Graph, now time.Time) Graph {
	protected := spansProtectedByFutureDeadlinesAt(graph.Spans, graph.Events, now)
	graph.Run = stalePresentationRunAt(graph.Run, len(protected) > 0, now)
	for i := range graph.Spans {
		_, protect := protected[graph.Spans[i].SpanID]
		graph.Spans[i] = stalePresentationSpanAt(graph.Spans[i], protect, graph.Run.lastActivityAt, now)
	}
	return graph
}

func stalePresentationRun(run RunSummary, protectedByDeadline bool) RunSummary {
	return stalePresentationRunAt(run, protectedByDeadline, time.Now())
}

func stalePresentationRunAt(run RunSummary, protectedByDeadline bool, now time.Time) RunSummary {
	if !protectedByDeadline && run.Status == "running" && run.EndedAt == "" && isStaleTimestampAt(staleTimestampAnchor(run.lastActivityAt, run.StartedAt), now) {
		run.Status = "incomplete"
		run.DurationMs = durationSinceTimestampAt(run.StartedAt, now)
	}
	return run
}

func stalePresentationSpan(span SpanSummary, protectedByDeadline bool) SpanSummary {
	return stalePresentationSpanAt(span, protectedByDeadline, "", time.Now())
}

func stalePresentationSpanAt(span SpanSummary, protectedByDeadline bool, activityAt string, now time.Time) SpanSummary {
	if !protectedByDeadline && span.Status == "running" && span.EndedAt == "" && isStaleTimestampAt(staleTimestampAnchor(activityAt, span.StartedAt), now) {
		span.Status = "stale"
		span.DurationMs = durationSinceTimestampAt(span.StartedAt, now)
	}
	return span
}

func staleTimestampAnchor(activityAt string, startedAt string) string {
	if activityAt != "" {
		return activityAt
	}
	return startedAt
}

func spansProtectedByFutureDeadlines(spans []SpanSummary) map[string]struct{} {
	return spansProtectedByFutureDeadlinesAt(spans, nil, time.Now())
}

func spansProtectedByFutureDeadlinesAt(spans []SpanSummary, events []SpanEventSummary, now time.Time) map[string]struct{} {
	protected := make(map[string]struct{})
	parentBySpan := make(map[string]string, len(spans))
	for _, span := range spans {
		parentBySpan[span.SpanID] = span.ParentSpanID
	}
	protectAncestors := func(spanID string) {
		for spanID != "" {
			protected[spanID] = struct{}{}
			spanID = parentBySpan[spanID]
		}
	}
	for _, span := range spans {
		if span.EndedAt != "" || span.Status != "running" {
			continue
		}
		deadline, ok := operationDeadlineFromSpan(span)
		if !ok {
			continue
		}
		deadlineAt, err := time.Parse(time.RFC3339Nano, deadline.DeadlineAt)
		if err != nil || !now.Before(deadlineAt) {
			continue
		}
		protectAncestors(span.SpanID)
	}

	leases := convexBoundaryLeasesBySpan(events)
	if len(leases) == 0 {
		return protected
	}
	for _, span := range spans {
		if span.EndedAt != "" || span.Status != "running" || !isConvexBoundarySpan(span) {
			continue
		}
		lease, ok := leases[span.SpanID]
		if !ok {
			continue
		}
		expiresAt, err := time.Parse(time.RFC3339Nano, lease.LeaseExpiresAt)
		if err != nil || !now.Before(expiresAt) {
			continue
		}
		protectAncestors(span.SpanID)
	}
	return protected
}
