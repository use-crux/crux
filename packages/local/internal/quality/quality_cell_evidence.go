package quality

import (
	"context"
	"sort"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// CellEvidenceAPI builds the server-owned evidence read model for one
// experiment cell. It joins only local, already-redacted Quality records and
// does not fetch unredacted trace payloads.
func (s *Service) CellEvidenceAPI(ctx context.Context, query api.QualityCellEvidenceQuery) (api.QualityCellEvidence, bool, error) {
	record, found, err := s.experimentDetail(ctx, query.ExperimentID)
	if err != nil || !found {
		return api.QualityCellEvidence{}, found, err
	}
	cell, ok := findExperimentCell(record.Cases, query)
	if !ok {
		return api.QualityCellEvidence{}, false, nil
	}

	sourceRoot := diskSourceFrameRoot(s.dir)
	outcomes := evidenceAssertionOutcomes(cell)
	normalizeAssertionOutcomeSourceFrames(outcomes)
	scores := evidenceScores(cell.Scores)
	errorFrame := evidenceRuntimeErrorSourceFrame(cell, sourceRoot)
	checks, thresholds := evidenceChecks(cell, outcomes, scores, errorFrame)
	gateChecks, gateThresholds := evidenceGateChecks(record.Gates, cell, scores, thresholds)
	checks = append(checks, gateChecks...)
	for name, threshold := range gateThresholds {
		thresholds[name] = threshold
	}
	for index := range scores {
		if threshold, ok := thresholds[scores[index].Name]; ok {
			scores[index].Threshold = &threshold
		}
	}
	baseline, err := s.evidenceBaseline(ctx, record, cell, scores)
	if err != nil {
		return api.QualityCellEvidence{}, false, err
	}
	applyBaselineDeltas(scores, baseline.Deltas)
	trace, err := s.evidenceTrace(ctx, cell, checks)
	if err != nil {
		return api.QualityCellEvidence{}, false, err
	}

	primaryFrame := evidencePrimaryFrame(outcomes, errorFrame)
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
		Baseline:   baseline,
		Trace:      trace,
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
	out := make([]api.QualityAssertionOutcome, len(cell.Assertions.Outcomes))
	copy(out, cell.Assertions.Outcomes)
	return out
}

func evidenceRuntimeErrorSourceFrame(cell api.QualityExperimentCell, sourceRoot string) *api.QualitySourceFrame {
	if cell.Error == nil {
		return nil
	}
	if cell.Error.SourceFrame != nil {
		return cell.Error.SourceFrame
	}
	if cell.Error.SourceRef == "" {
		return nil
	}
	frame := resolveDiskSourceFrame(cell.Error.SourceRef, sourceRoot)
	return &frame
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
