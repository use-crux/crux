package quality

import (
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func evidenceChecks(
	cell api.QualityExperimentCell,
	outcomes []api.QualityAssertionOutcome,
	scores []api.QualityScoreEvidence,
	errorFrame *api.QualitySourceFrame,
) ([]api.QualityCheckEvidence, map[string]api.QualityScoreThreshold) {
	checks := []api.QualityCheckEvidence{}
	thresholds := map[string]api.QualityScoreThreshold{}
	for _, outcome := range outcomes {
		checks = append(checks, api.QualityCheckEvidence{
			Kind:        "assertion",
			OutcomeID:   outcome.ID,
			Status:      outcome.Status,
			Summary:     assertionSummary(outcome),
			Message:     outcome.Message,
			SourceFrame: outcome.SourceFrame,
			Expression:  outcome.Expression,
			SpanIDs:     append([]string{}, outcome.SpanIDs...),
		})
		if check, threshold, ok := scoreThresholdCheck(outcome, scores); ok {
			checks = append(checks, check)
			thresholds[check.ScoreName] = threshold
		}
	}
	if cell.Error != nil {
		checks = append(checks, api.QualityCheckEvidence{
			Kind:        "runtime-error",
			Phase:       cell.Error.Phase,
			Message:     cell.Error.Message,
			SourceFrame: errorFrame,
			SpanIDs:     []string{},
		})
	}
	return checks, thresholds
}

func scoreThresholdCheck(
	outcome api.QualityAssertionOutcome,
	scores []api.QualityScoreEvidence,
) (api.QualityCheckEvidence, api.QualityScoreThreshold, bool) {
	if outcome.Expression == nil || outcome.Expression.Right == nil || !isThresholdOperator(outcome.Expression.Operator) {
		return api.QualityCheckEvidence{}, api.QualityScoreThreshold{}, false
	}
	thresholdValue, ok := numericValue(outcome.Expression.Right.Value)
	if !ok {
		return api.QualityCheckEvidence{}, api.QualityScoreThreshold{}, false
	}
	scoreName, scoreValue, rationale, ok := matchingScore(outcome.Expression.Left.Value, scores)
	if !ok {
		return api.QualityCheckEvidence{}, api.QualityScoreThreshold{}, false
	}
	threshold := api.QualityScoreThreshold{
		Source:   "assertion",
		Operator: outcome.Expression.Operator,
		Value:    thresholdValue,
		Passed:   outcome.Expression.Result,
	}
	return api.QualityCheckEvidence{
		Kind:        "score-threshold",
		ScoreName:   scoreName,
		Score:       &scoreValue,
		Operator:    outcome.Expression.Operator,
		Threshold:   &thresholdValue,
		Passed:      &outcome.Expression.Result,
		Source:      "assertion",
		Message:     scoreThresholdMessage(scoreValue, outcome.Expression.Operator, thresholdValue, outcome.Expression.Result),
		SourceFrame: outcome.SourceFrame,
		Rationale:   rationale,
		SpanIDs:     append([]string{}, outcome.SpanIDs...),
	}, threshold, true
}

func evidenceGateChecks(
	gates api.QualityExperimentGates,
	cell api.QualityExperimentCell,
	scores []api.QualityScoreEvidence,
	existingThresholds map[string]api.QualityScoreThreshold,
) ([]api.QualityCheckEvidence, map[string]api.QualityScoreThreshold) {
	checks := []api.QualityCheckEvidence{}
	thresholds := map[string]api.QualityScoreThreshold{}
	for _, result := range gates.Results {
		scoreName, operator, ok := scoreGateThreshold(result)
		if !ok || resultDoesNotApplyToCell(result, cell) {
			continue
		}
		if _, exists := existingThresholds[scoreName]; exists {
			continue
		}
		thresholdValue, ok := numericValue(result.Threshold)
		if !ok {
			continue
		}
		score, ok := scoreEvidenceByName(scores, scoreName)
		if !ok {
			continue
		}
		scoreValue := score.Score
		passed := compareScoreThreshold(scoreValue, operator, thresholdValue)
		threshold := api.QualityScoreThreshold{
			Source:   "gate",
			Operator: operator,
			Value:    thresholdValue,
			Passed:   passed,
		}
		checks = append(checks, api.QualityCheckEvidence{
			Kind:      "score-threshold",
			ScoreName: scoreName,
			Score:     &scoreValue,
			Operator:  operator,
			Threshold: &thresholdValue,
			Passed:    &passed,
			Source:    "gate",
			Message:   scoreThresholdMessage(scoreValue, operator, thresholdValue, passed),
			Rationale: score.Rationale,
		})
		thresholds[scoreName] = threshold
	}
	return checks, thresholds
}

func scoreThresholdMessage(score float64, operator string, threshold float64, passed bool) string {
	scoreText := scoreThresholdNumber(score)
	thresholdText := scoreThresholdNumber(threshold)
	if passed {
		switch operator {
		case ">=", ">":
			return scoreText + " meets the " + thresholdText + " floor"
		case "<=", "<":
			return scoreText + " stays within the " + thresholdText + " ceiling"
		case "==":
			return scoreText + " matches the " + thresholdText + " target"
		case "!=":
			return scoreText + " differs from the " + thresholdText + " target"
		default:
			return scoreText + " satisfies " + operator + " " + thresholdText
		}
	}
	switch operator {
	case ">=", ">":
		return scoreText + " is below the " + thresholdText + " floor"
	case "<=", "<":
		return scoreText + " is above the " + thresholdText + " ceiling"
	case "==":
		return scoreText + " does not match the " + thresholdText + " target"
	case "!=":
		return scoreText + " unexpectedly matches the " + thresholdText + " target"
	default:
		return scoreText + " does not satisfy " + operator + " " + thresholdText
	}
}

func scoreThresholdNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}

func scoreGateThreshold(result api.QualityGateResult) (string, string, bool) {
	const prefix = "scores."
	if !strings.HasPrefix(result.Gate, prefix) {
		return "", "", false
	}
	nameWithGate := strings.TrimPrefix(result.Gate, prefix)
	if scoreName, ok := strings.CutSuffix(nameWithGate, ".min"); ok {
		return scoreName, ">=", scoreName != ""
	}
	if scoreName, ok := strings.CutSuffix(nameWithGate, ".max"); ok {
		return scoreName, "<=", scoreName != ""
	}
	return "", "", false
}

func resultDoesNotApplyToCell(result api.QualityGateResult, cell api.QualityExperimentCell) bool {
	return result.VariantName != "" && result.VariantName != cell.VariantName
}

func scoreEvidenceByName(scores []api.QualityScoreEvidence, name string) (api.QualityScoreEvidence, bool) {
	for _, score := range scores {
		if score.Name == name {
			return score, true
		}
	}
	return api.QualityScoreEvidence{}, false
}

func compareScoreThreshold(score float64, operator string, threshold float64) bool {
	switch operator {
	case ">=":
		return score >= threshold
	case ">":
		return score > threshold
	case "<=":
		return score <= threshold
	case "<":
		return score < threshold
	case "==":
		return score == threshold
	case "!=":
		return score != threshold
	default:
		return false
	}
}
