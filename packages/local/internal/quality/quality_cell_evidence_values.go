package quality

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func assertionSummary(outcome api.QualityAssertionOutcome) string {
	if outcome.Message != "" {
		return outcome.Message
	}
	if outcome.Expression != nil && outcome.Expression.Rendered != "" {
		return outcome.Expression.Rendered
	}
	return strings.TrimSpace(outcome.Matcher + " " + outcome.Status)
}

func evidencePrimaryFrame(outcomes []api.QualityAssertionOutcome) api.QualitySourceFrame {
	for _, outcome := range outcomes {
		if outcome.Status == "passed" || outcome.SourceFrame == nil {
			continue
		}
		return *outcome.SourceFrame
	}
	for _, outcome := range outcomes {
		if outcome.Status == "passed" {
			continue
		}
		if outcome.SourceRef != "" {
			return api.QualitySourceFrame{Kind: "unavailable", Reason: "source-map-missing"}
		}
	}
	return api.QualitySourceFrame{Kind: "unavailable", Reason: "no-source-ref"}
}

func evidenceEditorLocation(frame api.QualitySourceFrame) *api.QualityEditorLocation {
	if frame.Kind != "source-frame" || frame.AuthoredFile == "" || frame.AuthoredLine == 0 {
		return nil
	}
	return &api.QualityEditorLocation{
		File:   frame.AuthoredFile,
		Line:   frame.AuthoredLine,
		Column: frame.AuthoredColumn,
	}
}

func evidenceValuesAtCheck(cell api.QualityExperimentCell, scores []api.QualityScoreEvidence) []api.QualityEvidenceValue {
	values := []api.QualityEvidenceValue{
		evidenceValue("input", cell.Input),
		evidenceValue("variant.name", cell.VariantName),
		evidenceValue("trial", cell.Trial),
		evidenceValue("durationMs", cell.DurationMs),
	}
	if cell.Output != nil {
		values = append(values, evidenceValue("output", cell.Output))
	}
	if cell.Expected != nil {
		values = append(values, evidenceValue("expected", cell.Expected))
	}
	if cell.CostUsd != nil {
		values = append(values, evidenceValue("costUsd", *cell.CostUsd))
	}
	if cell.Usage != nil {
		values = append(values, evidenceValue("usage", *cell.Usage))
	}
	for _, score := range scores {
		values = append(values, evidenceValue("score."+score.Name, score.Score))
		if score.Threshold != nil {
			values = append(values, evidenceValue("threshold."+score.Name, score.Threshold.Value))
		}
	}
	if len(cell.TraceIDs) == 1 {
		values = append(values, evidenceValue("traceId", cell.TraceIDs[0]))
	} else if len(cell.TraceIDs) > 1 {
		values = append(values, evidenceValue("traceIds", cell.TraceIDs))
	}
	return values
}

func evidenceValue(label string, value any) api.QualityEvidenceValue {
	return api.QualityEvidenceValue{
		Label:    label,
		Value:    value,
		Preview:  evidencePreview(value),
		Redacted: containsRedacted(value),
	}
}

func evidencePreview(value any) string {
	switch typed := value.(type) {
	case nil:
		return "null"
	case string:
		return truncateEvidencePreview(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case bool:
		return strconv.FormatBool(typed)
	default:
		data, err := json.Marshal(typed)
		if err != nil {
			return "<unpreviewable>"
		}
		return truncateEvidencePreview(string(data))
	}
}

func truncateEvidencePreview(value string) string {
	const max = 200
	if len(value) <= max {
		return value
	}
	return value[:max] + "..."
}

func evidenceBaseline(record api.QualityExperimentDetail) api.QualityBaselineEvidence {
	if record.BaselineRef == nil {
		return api.QualityBaselineEvidence{Kind: "unavailable", Reason: "no-baseline"}
	}
	return api.QualityBaselineEvidence{
		Kind:         "unavailable",
		BaselineID:   record.BaselineRef.BaselineID,
		ExperimentID: record.BaselineRef.ExperimentID,
		Reason:       "baseline-has-no-output-evidence",
	}
}

func evidenceTrace(cell api.QualityExperimentCell) api.QualityTraceEvidence {
	return api.QualityTraceEvidence{
		TraceIDs:   append([]string{}, cell.TraceIDs...),
		HotSpanIDs: []string{},
		Spans:      []api.QualityTraceSpanEvidence{},
	}
}

func evidenceRepro(query api.QualityCellEvidenceQuery) api.QualityReproEvidence {
	return api.QualityReproEvidence{
		Command: "crux",
		Args: []string{
			"quality",
			"cell-evidence",
			query.ExperimentID,
			"--case",
			query.CaseID,
			"--variant",
			query.VariantName,
			"--trial",
			strconv.Itoa(query.Trial),
			"--json",
		},
	}
}

func scoreRationale(metadata map[string]any) string {
	for _, key := range []string{"rationale", "reasoning"} {
		if value, ok := metadata[key].(string); ok {
			return value
		}
	}
	return ""
}

func copyMetadata(metadata map[string]any) map[string]any {
	if len(metadata) == 0 {
		return nil
	}
	out := make(map[string]any, len(metadata))
	for key, value := range metadata {
		out[key] = value
	}
	return out
}

func isThresholdOperator(operator string) bool {
	switch operator {
	case ">=", ">", "<=", "<", "==", "!=":
		return true
	default:
		return false
	}
}

func matchingScore(value any, scores []api.QualityScoreEvidence) (string, float64, string, bool) {
	numeric, ok := numericValue(value)
	if !ok {
		return "", 0, "", false
	}
	for _, score := range scores {
		if math.Abs(score.Score-numeric) <= 1e-9 {
			return score.Name, score.Score, score.Rationale, true
		}
	}
	return "", 0, "", false
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		value, err := typed.Float64()
		return value, err == nil
	default:
		return 0, false
	}
}

func boolMetadata(metadata map[string]any, key string) bool {
	value, ok := metadata[key].(bool)
	return ok && value
}

func containsRedacted(value any) bool {
	switch typed := value.(type) {
	case string:
		return typed == "[redacted]"
	case map[string]any:
		for _, nested := range typed {
			if containsRedacted(nested) {
				return true
			}
		}
	case []any:
		for _, nested := range typed {
			if containsRedacted(nested) {
				return true
			}
		}
	}
	return false
}
