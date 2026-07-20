package inspect

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func buildInspectRunDetailFromObservability(ctx context.Context, obs *observability.Service, dir string, projectRoot string, id string) (inspectRunDetailRecord, bool, error) {
	detail, found, err := observabilityRunDetailByRunOrTraceID(ctx, obs, id)
	if err != nil || !found {
		return inspectRunDetailRecord{}, found, err
	}
	run := inspectRunFromObservabilitySummary(detail.Run)
	run = enrichInspectRunWithObservabilitySignals(run, detail)
	return inspectRunDetailRecord{
		Tag:       "InspectRunDetail",
		Run:       run,
		Trace:     traceFromObservabilityRunDetail(detail),
		Events:    correlatedEventsFromObservabilityRunDetail(detail),
		Spans:     spansFromObservabilityRunDetail(detail),
		Narrative: narrativeFromObservabilityRunDetail(detail),
	}, true, nil
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

func inspectRunFromObservabilitySummary(summary observability.RunSummary) inspectRunRecord {
	metrics := jsonObject(summary.Metrics)
	attrs := jsonObject(summary.Attributes)
	promptID := optionalStringPtr(summary.PromptID)
	cost := optionalFloatMetric(metrics, "costUsd", "cost")
	spanCount := maxInt(summary.SpanCount, 0)
	return inspectRunRecord{
		Tag:           "InspectRun",
		OperationID:   summary.OperationID,
		TraceID:       summary.TraceID,
		TargetID:      firstNonEmpty(summary.PromptID, summary.Name, summary.RootPrimitive, summary.RunID),
		PromptID:      promptID,
		FlowID:        stringMetric(attrs, "flowId", "flowID"),
		ParentRunID:   stringMetric(attrs, "parentRunId", "parent_run_id"),
		RootPrimitive: summary.RootPrimitive,
		Kind:          inspectRunKindFromRootPrimitive(summary.RootPrimitive),
		Status:        normalizeStatus(summary.Status),
		StartedAt:     parseTimeMillis(summary.StartedAt),
		DurationMs:    optionalDuration(summary.DurationMs),
		Model:         summary.Model,
		Provider:      summary.Provider,
		Error:         jsonAny(summary.Error),
		Cost:          cost,
		TokenCount:    intMetric(metrics, "totalTokens"),
		SpanCount:     spanCount,
		ChildCount:    summary.ChildRunCount,
		TraceCount:    1,
		SessionID:     stringMetric(attrs, "sessionId", "sessionID"),
	}
}

func traceFromObservabilityRunDetail(detail observability.RunDetail) inspectTraceRecord {
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
	return inspectTraceRecord{
		TraceID:    run.TraceID,
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

func spansFromObservabilityRunDetail(detail observability.RunDetail) []inspectRunSpan {
	nodesByID := map[string]observability.RunDetailNode{}
	indexRunDetailNodes(detail.Root, nodesByID)
	spans := make([]inspectRunSpan, 0, len(detail.Rows))
	for _, row := range detail.Rows {
		node, ok := nodesByID[row.NodeID]
		if !ok || isVirtualRunDetailRoot(node) {
			continue
		}
		metrics := jsonObject(firstRawMessage(node.MetricBuckets.Total, node.MetricBuckets.Own, node.Metrics))
		attrs := stringAttributes(node.Attributes)
		cost := optionalFloatMetric(metrics, "costUsd", "cost")
		spans = append(spans, inspectRunSpan{
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
