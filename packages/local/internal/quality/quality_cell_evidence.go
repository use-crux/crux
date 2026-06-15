package quality

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// CellEvidenceAPI builds the server-owned evidence read model for one
// experiment cell. It joins only local, already-redacted Quality records; it
// does not fetch unredacted trace payloads or synthesize source code.
func (s *Service) CellEvidenceAPI(ctx context.Context, query api.QualityCellEvidenceQuery) (api.QualityCellEvidence, bool, error) {
	raw, found, err := s.ExperimentRecordAPI(ctx, query.ExperimentID)
	if err != nil || !found {
		return api.QualityCellEvidence{}, found, err
	}
	var record api.QualityExperimentDetail
	if err := json.Unmarshal(raw, &record); err != nil {
		return api.QualityCellEvidence{}, false, err
	}
	cell, ok := findExperimentCell(record.Cases, query)
	if !ok {
		return api.QualityCellEvidence{}, false, nil
	}

	outcomes := evidenceAssertionOutcomes(cell)
	scores := evidenceScores(cell.Scores)
	checks, thresholds := evidenceChecks(cell, outcomes, scores)
	for index := range scores {
		if threshold, ok := thresholds[scores[index].Name]; ok {
			scores[index].Threshold = &threshold
		}
	}

	primaryFrame := evidencePrimaryFrame(outcomes)
	return api.QualityCellEvidence{
		Tag:           "QualityCellEvidence",
		SchemaVersion: 1,
		ExperimentID:  record.ExperimentID,
		EvaluationID:  record.EvaluationID,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Cell:          evidenceCellIdentity(cell),
		TrialSummary:  evidenceTrialSummary(record.Cases, cell),
		IO:            evidenceIO(cell),
		Scores:        scores,
		Assertions: api.QualityAssertionEvidence{
			Ran:          cell.Assertions.Ran,
			NotEvaluated: cell.Assertions.NotEvaluated,
			Outcomes:     outcomes,
		},
		Checks: checks,
		Code: api.QualityCodeEvidence{
			PrimaryFrame:   primaryFrame,
			ValuesAtCheck:  evidenceValuesAtCheck(cell, scores),
			OpenedInEditor: evidenceEditorLocation(primaryFrame),
		},
		Baseline:   evidenceBaseline(record),
		Trace:      evidenceTrace(cell),
		Repro:      evidenceRepro(query),
		Provenance: api.QualityEvidenceProvenance{},
	}, true, nil
}

func findExperimentCell(cells []api.QualityExperimentCell, query api.QualityCellEvidenceQuery) (api.QualityExperimentCell, bool) {
	for _, cell := range cells {
		if cell.CaseID == query.CaseID && cell.VariantName == query.VariantName && cell.Trial == query.Trial {
			return cell, true
		}
	}
	return api.QualityExperimentCell{}, false
}

func evidenceCellIdentity(cell api.QualityExperimentCell) api.QualityCellIdentity {
	return api.QualityCellIdentity{
		CaseID:          cell.CaseID,
		CaseName:        cell.CaseName,
		VariantName:     cell.VariantName,
		Trial:           cell.Trial,
		Status:          cell.Status,
		DurationMs:      cell.DurationMs,
		CostUsd:         cell.CostUsd,
		Usage:           cell.Usage,
		TraceIDs:        append([]string{}, cell.TraceIDs...),
		CapturedSignals: append([]string{}, cell.CapturedSignals...),
		Error:           cell.Error,
	}
}

func evidenceTrialSummary(cells []api.QualityExperimentCell, selected api.QualityExperimentCell) api.QualityTrialSummary {
	summary := api.QualityTrialSummary{SelectedTrial: selected.Trial}
	for _, cell := range cells {
		if cell.CaseID != selected.CaseID || cell.VariantName != selected.VariantName {
			continue
		}
		summary.Total++
		switch cell.Status {
		case "passed":
			summary.Passed++
		case "failed":
			summary.Failed++
		case "errored":
			summary.Errored++
		case "skipped":
			summary.Skipped++
		}
		summary.Trials = append(summary.Trials, api.QualityTrialSummaryTrial{
			Trial:          cell.Trial,
			Status:         cell.Status,
			DurationMs:     cell.DurationMs,
			PrimaryFailure: primaryFailure(cell),
		})
	}
	sort.Slice(summary.Trials, func(i, j int) bool { return summary.Trials[i].Trial < summary.Trials[j].Trial })
	summary.Verdict = trialVerdict(summary)
	return summary
}

func trialVerdict(summary api.QualityTrialSummary) string {
	if summary.Total > 0 && summary.Errored == summary.Total {
		return "all-errored"
	}
	if summary.Total > 0 && summary.Passed == summary.Total {
		return "stable-pass"
	}
	if summary.Total > 0 && summary.Failed == summary.Total {
		return "stable-fail"
	}
	if summary.Passed > 0 && (summary.Failed > 0 || summary.Errored > 0) {
		return "flaky"
	}
	return "mixed"
}

func primaryFailure(cell api.QualityExperimentCell) string {
	if cell.Error != nil && cell.Error.Message != "" {
		return cell.Error.Message
	}
	for _, outcome := range evidenceAssertionOutcomes(cell) {
		if outcome.Status == "failed" || outcome.Status == "uncaptured" {
			return nonEmptyString(outcome.Message, outcome.Matcher)
		}
	}
	if len(cell.Assertions.Failures) > 0 {
		return nonEmptyString(cell.Assertions.Failures[0].Message, cell.Assertions.Failures[0].Matcher)
	}
	return ""
}

func evidenceIO(cell api.QualityExperimentCell) api.QualityCellIOEvidence {
	return api.QualityCellIOEvidence{
		Input:            cell.Input,
		Output:           cell.Output,
		Expected:         cell.Expected,
		OutputTruncated:  boolMetadata(cell.Metadata, "truncated"),
		RedactionApplied: containsRedacted(cell.Input) || containsRedacted(cell.Output) || containsRedacted(cell.Expected),
	}
}

func evidenceAssertionOutcomes(cell api.QualityExperimentCell) []api.QualityAssertionOutcome {
	if len(cell.Assertions.Outcomes) > 0 {
		out := make([]api.QualityAssertionOutcome, len(cell.Assertions.Outcomes))
		copy(out, cell.Assertions.Outcomes)
		return out
	}
	out := make([]api.QualityAssertionOutcome, 0, len(cell.Assertions.Failures))
	for index, failure := range cell.Assertions.Failures {
		outcome := api.QualityAssertionOutcome{
			ID:        fmt.Sprintf("legacy-failure-%d", index),
			Level:     nonEmptyString(failure.Level, "evaluation"),
			Phase:     "expect",
			Index:     failure.Index,
			Status:    "failed",
			Matcher:   failure.Matcher,
			Soft:      failure.Soft,
			Message:   failure.Message,
			SourceRef: failure.SourceRef,
		}
		if failure.ActualPreview != "" {
			outcome.Actual = &api.QualityEvidenceValue{Label: "actual", Value: failure.ActualPreview, Preview: failure.ActualPreview}
		}
		if failure.ExpectedPreview != "" {
			outcome.Expected = &api.QualityEvidenceValue{Label: "expected", Value: failure.ExpectedPreview, Preview: failure.ExpectedPreview}
		}
		out = append(out, outcome)
	}
	return out
}

func evidenceScores(scores []api.QualityCellScore) []api.QualityScoreEvidence {
	out := make([]api.QualityScoreEvidence, 0, len(scores))
	for _, score := range scores {
		if score.Score == nil {
			continue
		}
		out = append(out, api.QualityScoreEvidence{
			Name:      score.Name,
			Score:     *score.Score,
			Label:     score.Label,
			CostClass: score.CostClass,
			Rationale: scoreRationale(score.Metadata),
			Metadata:  copyMetadata(score.Metadata),
		})
	}
	return out
}

func evidenceChecks(
	cell api.QualityExperimentCell,
	outcomes []api.QualityAssertionOutcome,
	scores []api.QualityScoreEvidence,
) ([]api.QualityCheckEvidence, map[string]api.QualityScoreThreshold) {
	checks := []api.QualityCheckEvidence{}
	thresholds := map[string]api.QualityScoreThreshold{}
	for _, outcome := range outcomes {
		if outcome.Status == "passed" {
			continue
		}
		checks = append(checks, api.QualityCheckEvidence{
			Kind:        "assertion",
			OutcomeID:   outcome.ID,
			Status:      outcome.Status,
			Summary:     assertionSummary(outcome),
			SourceFrame: outcome.SourceFrame,
			Expression:  outcome.Expression,
		})
		if check, threshold, ok := scoreThresholdCheck(outcome, scores); ok {
			checks = append(checks, check)
			thresholds[check.ScoreName] = threshold
		}
	}
	if cell.Error != nil {
		checks = append(checks, api.QualityCheckEvidence{
			Kind:    "runtime-error",
			Phase:   cell.Error.Phase,
			Message: cell.Error.Message,
			SpanIDs: []string{},
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
		SourceFrame: outcome.SourceFrame,
		Rationale:   rationale,
	}, threshold, true
}
