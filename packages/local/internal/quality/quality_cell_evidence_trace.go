package quality

import (
	"context"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (s *Service) evidenceTrace(
	ctx context.Context,
	cell api.QualityExperimentCell,
	checks []api.QualityCheckEvidence,
) (api.QualityTraceEvidence, error) {
	spans, retainedTraceIDs, err := s.traceEvidenceSpans(ctx, cell.TraceIDs)
	if err != nil {
		return api.QualityTraceEvidence{}, err
	}
	hotSpanIDs, rootCause := traceRootCause(checks, spans)
	hotSpans := stringSet(hotSpanIDs)
	return api.QualityTraceEvidence{
		TraceIDs:         append([]string{}, cell.TraceIDs...),
		RetainedTraceIDs: retainedTraceIDs,
		HotSpanIDs:       hotSpanIDs,
		RootCause:        rootCause,
		Spans:            compactTraceSpans(spans, hotSpans),
	}, nil
}

func traceRootCause(
	checks []api.QualityCheckEvidence,
	spans []qualityRunSpan,
) ([]string, *api.QualityTraceRootCause) {
	for _, check := range checks {
		if !checkFailed(check) || len(check.SpanIDs) == 0 {
			continue
		}
		spanIDs := uniqueStrings(check.SpanIDs)
		return spanIDs, &api.QualityTraceRootCause{
			Summary:    traceRootCauseSummary(check, "captured signal assertion"),
			SpanID:     spanIDs[0],
			Confidence: "exact",
		}
	}
	if spanIDs, rootCause := heuristicRootCauseForChecks(checks, spans, "score-threshold"); rootCause != nil {
		return spanIDs, rootCause
	}
	if spanIDs, rootCause := heuristicRootCauseForChecks(checks, spans, ""); rootCause != nil {
		return spanIDs, rootCause
	}
	return []string{}, nil
}

func heuristicRootCauseForChecks(
	checks []api.QualityCheckEvidence,
	spans []qualityRunSpan,
	kind string,
) ([]string, *api.QualityTraceRootCause) {
	for _, check := range checks {
		if kind != "" && check.Kind != kind {
			continue
		}
		if !checkFailed(check) {
			continue
		}
		spanID := heuristicTraceSpanID(check, spans)
		if spanID == "" {
			continue
		}
		return []string{spanID}, &api.QualityTraceRootCause{
			Summary:    traceRootCauseSummary(check, "trace heuristic"),
			SpanID:     spanID,
			Confidence: "heuristic",
		}
	}
	return []string{}, nil
}

func checkFailed(check api.QualityCheckEvidence) bool {
	switch check.Kind {
	case "assertion":
		return check.Status != "" && check.Status != "passed"
	case "score-threshold":
		return check.Passed != nil && !*check.Passed
	case "runtime-error":
		return true
	default:
		return false
	}
}

func heuristicTraceSpanID(check api.QualityCheckEvidence, spans []qualityRunSpan) string {
	switch check.Kind {
	case "score-threshold":
		if spanID := scoreThresholdSpanID(check, spans); spanID != "" {
			return spanID
		}
	case "runtime-error":
		if spanID := erroredTraceSpanID(spans); spanID != "" {
			return spanID
		}
	default:
		if spanID := finalGenerationSpanID(spans); spanID != "" {
			return spanID
		}
	}
	return rootTraceSpanID(spans)
}

func scoreThresholdSpanID(check api.QualityCheckEvidence, spans []qualityRunSpan) string {
	scoreName := strings.ToLower(check.ScoreName)
	for _, span := range spans {
		if !isScoringSpan(span) {
			continue
		}
		if scoreName == "" || strings.Contains(strings.ToLower(span.Name), scoreName) {
			return span.ID
		}
	}
	for _, span := range spans {
		if isScoringSpan(span) {
			return span.ID
		}
	}
	return ""
}

func isScoringSpan(span qualityRunSpan) bool {
	op := strings.ToLower(firstNonEmpty(span.Primitive, span.Op, span.Kind, span.Name))
	name := strings.ToLower(span.Name)
	return strings.Contains(op, "scor") || strings.Contains(name, "scor") || strings.Contains(name, "judge")
}

func erroredTraceSpanID(spans []qualityRunSpan) string {
	for _, span := range spans {
		if span.Status != "" && span.Status != "passed" && span.Status != "ok" && span.Status != "completed" {
			return span.ID
		}
	}
	return ""
}

func finalGenerationSpanID(spans []qualityRunSpan) string {
	for index := len(spans) - 1; index >= 0; index-- {
		span := spans[index]
		op := strings.ToLower(firstNonEmpty(span.Primitive, span.Op, span.Kind, span.Name))
		if strings.Contains(op, "generation") || strings.Contains(op, "model") {
			return span.ID
		}
	}
	return ""
}

func rootTraceSpanID(spans []qualityRunSpan) string {
	for _, span := range spans {
		if span.ParentID == "" {
			return span.ID
		}
	}
	if len(spans) > 0 {
		return spans[0].ID
	}
	return ""
}

func traceRootCauseSummary(check api.QualityCheckEvidence, fallback string) string {
	switch check.Kind {
	case "assertion":
		return firstNonEmpty(check.Summary, check.Message, fallback)
	case "score-threshold":
		if check.ScoreName != "" {
			return "Score threshold failed for " + check.ScoreName
		}
		return "Score threshold failed"
	case "runtime-error":
		return firstNonEmpty(check.Message, fallback)
	default:
		return fallback
	}
}

func uniqueStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func stringSet(values []string) map[string]bool {
	out := map[string]bool{}
	for _, value := range values {
		out[value] = true
	}
	return out
}
