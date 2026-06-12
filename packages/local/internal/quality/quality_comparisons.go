package quality

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

func createQualityComparison(dir string, req qualityComparisonPostRequest) (qualityComparisonRecord, error) {
	if req.Baseline.Experiment == "" || req.Candidate.Experiment == "" {
		return qualityComparisonRecord{}, fmt.Errorf("baseline.experiment and candidate.experiment are required")
	}
	snapshot, loadErr := qualityfs.Open(dir).Snapshot()
	if snapshot == nil {
		return qualityComparisonRecord{}, loadErr
	}
	baselineExperiment, ok := snapshot.ByID.Experiments[req.Baseline.Experiment]
	if !ok {
		return qualityComparisonRecord{}, qualityExperimentLookupError(req.Baseline.Experiment, loadErr)
	}
	candidateExperiment, ok := snapshot.ByID.Experiments[req.Candidate.Experiment]
	if !ok {
		return qualityComparisonRecord{}, qualityExperimentLookupError(req.Candidate.Experiment, loadErr)
	}
	baseline, err := summarizeQualityExperiment(baselineExperiment, req.Baseline.VariantID, req.Baseline.Label)
	if err != nil {
		return qualityComparisonRecord{}, err
	}
	candidate, err := summarizeQualityExperiment(candidateExperiment, req.Candidate.VariantID, req.Candidate.Label)
	if err != nil {
		return qualityComparisonRecord{}, err
	}
	metrics := compareQualitySummaries(baseline, candidate)
	id := req.ID
	if id == "" {
		id = comparisonID(req.Baseline, req.Candidate)
	}
	return qualityComparisonRecord{
		Tag:        "QualityComparison",
		ID:         id,
		QualityID:  nonEmptyString(candidateExperiment.QualityID, baselineExperiment.QualityID, "local"),
		ComparedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Baseline:   baseline,
		Candidate:  candidate,
		Metrics:    metrics,
		CaseDeltas: compareQualityExperimentCases(baselineExperiment, req.Baseline.VariantID, candidateExperiment, req.Candidate.VariantID),
		Status:     comparisonStatus(metrics),
	}, nil
}

func createQualityBaseline(dir string, req qualityBaselinePostRequest) (qualityBaselineRecord, error) {
	if req.ID == "" {
		return qualityBaselineRecord{}, fmt.Errorf("id is required")
	}
	if req.Experiment == "" {
		return qualityBaselineRecord{}, fmt.Errorf("experiment is required")
	}
	snapshot, loadErr := qualityfs.Open(dir).Snapshot()
	if snapshot == nil {
		return qualityBaselineRecord{}, loadErr
	}
	experiment, ok := snapshot.ByID.Experiments[req.Experiment]
	if !ok {
		return qualityBaselineRecord{}, qualityExperimentLookupError(req.Experiment, loadErr)
	}
	summary, err := summarizeQualityExperiment(experiment, req.VariantID, req.Label)
	if err != nil {
		return qualityBaselineRecord{}, err
	}
	return qualityBaselineRecord{
		Tag:          "QualityBaseline",
		ID:           req.ID,
		QualityID:    nonEmptyString(experiment.QualityID, "local"),
		ExperimentID: experiment.ID,
		VariantID:    req.VariantID,
		Label:        req.Label,
		PromotedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		Summary:      summary,
	}, nil
}

func summarizeQualityExperiment(
	experiment qualityExperimentRecord,
	variantID *string,
	label *string,
) (qualityComparisonSummary, error) {
	cases := experiment.Cases
	if variantID != nil {
		cases = []qualityExperimentCase{}
		for _, testCase := range experiment.Cases {
			if testCase.VariantID == *variantID {
				cases = append(cases, testCase)
			}
		}
		if len(cases) == 0 {
			return qualityComparisonSummary{}, fmt.Errorf("variant %q not found in experiment %q", *variantID, experiment.ID)
		}
	}

	passed := 0
	failed := 0
	errored := 0
	totalDuration := 0.0
	scoreSums := map[string]struct {
		sum   float64
		count int
	}{}
	for _, testCase := range cases {
		switch testCase.Status {
		case "passed":
			passed++
		case "error":
			errored++
		default:
			failed++
		}
		totalDuration += testCase.DurationMs
		for _, score := range testCase.Scores {
			if score.Kind != "numeric" || score.Value == nil {
				continue
			}
			current := scoreSums[score.Name]
			current.sum += *score.Value
			current.count++
			scoreSums[score.Name] = current
		}
	}
	numericScores := map[string]float64{}
	for name, sum := range scoreSums {
		if sum.count > 0 {
			numericScores[name] = sum.sum / float64(sum.count)
		}
	}
	total := len(cases)
	passRate := 0.0
	avgDurationMs := 0.0
	if total > 0 {
		passRate = float64(passed) / float64(total)
		avgDurationMs = totalDuration / float64(total)
	}

	return qualityComparisonSummary{
		ExperimentID:  experiment.ID,
		VariantID:     variantID,
		Label:         label,
		Total:         total,
		Passed:        passed,
		Failed:        failed,
		Errored:       errored,
		PassRate:      passRate,
		AvgDurationMs: avgDurationMs,
		NumericScores: numericScores,
	}, nil
}

func compareQualitySummaries(baseline qualityComparisonSummary, candidate qualityComparisonSummary) qualityComparisonMetrics {
	scoreNames := map[string]bool{}
	for name := range baseline.NumericScores {
		scoreNames[name] = true
	}
	for name := range candidate.NumericScores {
		scoreNames[name] = true
	}
	scoreDeltas := map[string]qualityNumericScoreDelta{}
	for name := range scoreNames {
		base, hasBase := baseline.NumericScores[name]
		cand, hasCand := candidate.NumericScores[name]
		delta := qualityNumericScoreDelta{}
		if hasBase {
			delta.Baseline = &base
		}
		if hasCand {
			delta.Candidate = &cand
		}
		if hasBase && hasCand {
			diff := cand - base
			delta.Delta = &diff
		}
		scoreDeltas[name] = delta
	}
	return qualityComparisonMetrics{
		PassRateDelta:      candidate.PassRate - baseline.PassRate,
		AvgDurationMsDelta: candidate.AvgDurationMs - baseline.AvgDurationMs,
		NumericScoreDeltas: scoreDeltas,
	}
}

func compareQualityExperimentCases(
	baseline qualityExperimentRecord,
	baselineVariantID *string,
	candidate qualityExperimentRecord,
	candidateVariantID *string,
) []qualityComparisonCaseDelta {
	baselineCases := qualityCasesByID(baseline.Cases, baselineVariantID)
	candidateCases := qualityCasesByID(candidate.Cases, candidateVariantID)
	caseIDs := []string{}
	for caseID := range baselineCases {
		caseIDs = appendUniqueString(caseIDs, caseID)
	}
	for caseID := range candidateCases {
		caseIDs = appendUniqueString(caseIDs, caseID)
	}
	sort.Strings(caseIDs)

	deltas := make([]qualityComparisonCaseDelta, 0, len(caseIDs))
	for _, caseID := range caseIDs {
		baseCase, hasBase := baselineCases[caseID]
		candCase, hasCand := candidateCases[caseID]
		delta := qualityComparisonCaseDelta{
			CaseID: caseID,
			Status: "unchanged",
		}
		if hasBase {
			delta.CaseName = baseCase.CaseName
			delta.Baseline = qualityComparisonCaseSideFromCase(baseCase)
		}
		if hasCand {
			if delta.CaseName == "" {
				delta.CaseName = candCase.CaseName
			}
			delta.Candidate = qualityComparisonCaseSideFromCase(candCase)
		}
		if hasBase && hasCand {
			basePassed := baseCase.Status == "passed"
			candPassed := candCase.Status == "passed"
			switch {
			case !basePassed && candPassed:
				delta.Status = "fixed"
			case basePassed && !candPassed:
				delta.Status = "regressed"
			case !basePassed && !candPassed:
				delta.Status = "still_failing"
			default:
				delta.Status = "unchanged"
			}
			if delta.Baseline != nil && delta.Candidate != nil && delta.Baseline.Score != nil && delta.Candidate.Score != nil {
				scoreDelta := *delta.Candidate.Score - *delta.Baseline.Score
				delta.ScoreDelta = &scoreDelta
			}
			if delta.Baseline != nil && delta.Candidate != nil && delta.Baseline.OutputPreview != delta.Candidate.OutputPreview {
				delta.OutputChange = "changed"
			}
		} else if hasCand {
			delta.Status = "new"
		} else {
			delta.Status = "removed"
		}
		deltas = append(deltas, delta)
	}
	return deltas
}

func qualityCasesByID(cases []qualityExperimentCase, variantID *string) map[string]qualityExperimentCase {
	byID := map[string]qualityExperimentCase{}
	for _, testCase := range cases {
		if variantID != nil && testCase.VariantID != *variantID {
			continue
		}
		caseID := nonEmptyString(testCase.CaseID, testCase.CaseName)
		if caseID == "" {
			continue
		}
		byID[caseID] = testCase
	}
	return byID
}

func qualityComparisonCaseSideFromCase(testCase qualityExperimentCase) *qualityComparisonCaseSide {
	return &qualityComparisonCaseSide{
		TraceID:       testCase.TraceID,
		Status:        testCase.Status,
		OutputPreview: qualityPreview(testCase.Output, 160),
		Score:         qualityFirstNumericScore(testCase.Scores),
		DurationMs:    testCase.DurationMs,
	}
}

func qualityFirstNumericScore(scores []qualityScore) *float64 {
	for _, score := range scores {
		if score.Kind == "numeric" && score.Value != nil {
			value := *score.Value
			return &value
		}
	}
	return nil
}

func qualityPreview(value any, limit int) string {
	if value == nil {
		return ""
	}
	var text string
	switch typed := value.(type) {
	case string:
		text = typed
	default:
		data, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		text = string(data)
	}
	text = strings.TrimSpace(text)
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "..."
}

func comparisonStatus(metrics qualityComparisonMetrics) string {
	if metrics.PassRateDelta > 0 && metrics.AvgDurationMsDelta <= 0 {
		return "candidate_better"
	}
	if metrics.PassRateDelta < 0 {
		return "candidate_worse"
	}
	if metrics.PassRateDelta == 0 && metrics.AvgDurationMsDelta == 0 {
		return "same"
	}
	return "mixed"
}

func comparisonID(baseline qualityComparisonSideRequest, candidate qualityComparisonSideRequest) string {
	return sideID(baseline) + "-vs-" + sideID(candidate)
}

// qualityExperimentLookupError reports a missing experiment, including the
// snapshot load error when partially unreadable records may explain the miss.
func qualityExperimentLookupError(experimentID string, loadErr error) error {
	if loadErr != nil {
		return fmt.Errorf("quality experiment %q not found (quality records partially unreadable: %v): %w", experimentID, loadErr, ErrNotFound)
	}
	return fmt.Errorf("quality experiment %q not found: %w", experimentID, ErrNotFound)
}

func sideID(side qualityComparisonSideRequest) string {
	if side.VariantID != nil && *side.VariantID != "" {
		return qualityfs.SafeFileName(side.Experiment + "-" + *side.VariantID)
	}
	return qualityfs.SafeFileName(side.Experiment)
}
