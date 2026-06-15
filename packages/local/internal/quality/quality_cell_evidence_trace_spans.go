package quality

import (
	"context"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func (s *Service) traceEvidenceSpans(ctx context.Context, traceIDs []string) ([]qualityRunSpan, error) {
	if s.obs == nil || len(traceIDs) == 0 {
		return []qualityRunSpan{}, nil
	}
	out := []qualityRunSpan{}
	for _, traceID := range traceIDs {
		detail, found, err := observabilityRunDetailByRunOrTraceID(ctx, s.obs, traceID)
		if err != nil {
			return nil, err
		}
		if !found {
			continue
		}
		out = append(out, traceSpansFromObservabilityDetail(detail)...)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].StartedAt == out[j].StartedAt {
			return out[i].ID < out[j].ID
		}
		return out[i].StartedAt < out[j].StartedAt
	})
	return out, nil
}

func traceSpansFromObservabilityDetail(detail observability.RunDetail) []qualityRunSpan {
	spans := []qualityRunSpan{}
	seen := map[string]bool{}
	var visit func(observability.RunDetailNode)
	visit = func(node observability.RunDetailNode) {
		if !isVirtualRunDetailRoot(node) {
			appendTraceSpan(&spans, seen, traceSpanFromRunDetailNode(node))
		}
		for _, detail := range node.Details {
			appendTraceSpan(&spans, seen, traceSpanFromRunDetailDetail(detail))
		}
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(detail.Root)
	return spans
}

func appendTraceSpan(spans *[]qualityRunSpan, seen map[string]bool, span qualityRunSpan) {
	if span.ID == "" || seen[span.ID] {
		return
	}
	seen[span.ID] = true
	*spans = append(*spans, span)
}

func traceSpanFromRunDetailNode(node observability.RunDetailNode) qualityRunSpan {
	metrics := jsonObject(firstRawMessage(node.MetricBuckets.Total, node.MetricBuckets.Own, node.Metrics))
	attrs := stringAttributes(node.Attributes)
	cost := optionalFloatMetric(metrics, "costUsd", "cost")
	return qualityRunSpan{
		ID:              node.SpanID,
		ParentID:        node.ParentSpanID,
		Kind:            firstNonEmpty(node.Display.Kind, node.Family, node.Kind),
		Op:              node.Primitive,
		Primitive:       firstNonEmpty(node.Primitive, node.Family),
		CompositionType: compositionTypeFromPrimitive(node.Primitive),
		Name:            firstNonEmpty(node.Display.Label, node.Name, node.Primitive, node.SpanID),
		Status:          normalizeStatus(node.Status),
		StartedAt:       parseTimeMillis(node.Timing.StartedAt),
		EndedAt:         parseTimeMillis(node.Timing.EndedAt),
		DurationMs:      optionalDuration(node.Timing.DurationMs),
		TokenCount:      intMetric(metrics, "totalTokens"),
		Cost:            cost,
		Attributes:      attrs,
		Data:            node.Attributes,
	}
}

func traceSpanFromRunDetailDetail(detail observability.RunDetailDetail) qualityRunSpan {
	metrics := jsonObject(detail.Metrics)
	attrs := stringAttributes(detail.Attributes)
	cost := optionalFloatMetric(metrics, "costUsd", "cost")
	return qualityRunSpan{
		ID:              detail.SpanID,
		ParentID:        detail.ParentSpanID,
		Kind:            firstNonEmpty(detail.Kind, detail.Family),
		Op:              detail.Primitive,
		Primitive:       firstNonEmpty(detail.Primitive, detail.Family),
		CompositionType: compositionTypeFromPrimitive(detail.Primitive),
		Name:            firstNonEmpty(detail.Label, detail.Display, detail.Name, detail.Primitive, detail.SpanID),
		Status:          normalizeStatus(detail.Status),
		StartedAt:       parseTimeMillis(detail.Timing.StartedAt),
		EndedAt:         parseTimeMillis(detail.Timing.EndedAt),
		DurationMs:      optionalDuration(detail.Timing.DurationMs),
		TokenCount:      intMetric(metrics, "totalTokens"),
		Cost:            cost,
		Attributes:      attrs,
		Data:            detail.Attributes,
	}
}

func compactTraceSpans(spans []qualityRunSpan, hotSpans map[string]bool) []api.QualityTraceSpanEvidence {
	if len(spans) == 0 {
		return []api.QualityTraceSpanEvidence{}
	}
	start := firstTraceStart(spans)
	out := make([]api.QualityTraceSpanEvidence, 0, len(spans))
	for _, span := range spans {
		out = append(out, api.QualityTraceSpanEvidence{
			SpanID:       span.ID,
			ParentSpanID: span.ParentID,
			Name:         span.Name,
			Kind:         firstNonEmpty(span.Primitive, span.Op, span.Kind),
			StartMs:      traceStartOffset(span.StartedAt, start),
			DurationMs:   traceDuration(span),
			Status:       span.Status,
			Hot:          hotSpans[span.ID],
		})
	}
	return out
}

func firstTraceStart(spans []qualityRunSpan) int64 {
	for _, span := range spans {
		if span.StartedAt > 0 {
			return span.StartedAt
		}
	}
	return 0
}

func traceStartOffset(startedAt int64, rootStart int64) float64 {
	if startedAt == 0 || rootStart == 0 {
		return 0
	}
	return float64(startedAt - rootStart)
}

func traceDuration(span qualityRunSpan) float64 {
	if span.DurationMs == nil {
		return 0
	}
	return *span.DurationMs
}
