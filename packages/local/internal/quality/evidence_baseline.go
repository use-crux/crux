package quality

import (
	"context"
	"encoding/json"
	"math"
	"reflect"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (s *Service) experimentDetail(ctx context.Context, experimentID string) (api.QualityExperimentDetail, bool, error) {
	raw, found, err := s.ExperimentRecordAPI(ctx, experimentID)
	if err != nil || !found {
		return api.QualityExperimentDetail{}, found, err
	}
	var record api.QualityExperimentDetail
	if err := json.Unmarshal(raw, &record); err != nil {
		return api.QualityExperimentDetail{}, false, err
	}
	return record, true, nil
}

func (s *Service) evidenceBaseline(
	ctx context.Context,
	record api.QualityExperimentDetail,
	cell api.QualityExperimentCell,
	scores []api.QualityScoreEvidence,
) (api.QualityBaselineEvidence, error) {
	ref := record.BaselineRef
	if ref == nil {
		return api.QualityBaselineEvidence{Kind: "unavailable", Reason: "no-baseline"}, nil
	}

	if ref.ExperimentID == "" {
		return unavailableBaseline(*ref, "baseline-has-no-output-evidence"), nil
	}

	baselineRecordExists, err := s.baselineRecordExists(ctx, record.EvaluationID)
	if err != nil {
		return api.QualityBaselineEvidence{}, err
	}

	source, found, err := s.experimentDetail(ctx, ref.ExperimentID)
	if err != nil {
		return api.QualityBaselineEvidence{}, err
	}
	if !found {
		if baselineRecordExists {
			return unavailableBaseline(*ref, "baseline-has-no-output-evidence"), nil
		}
		return unavailableBaseline(*ref, "baseline-experiment-missing"), nil
	}

	baselineCell, found, caseExists := findBaselineCell(source.Cells, cell, ref.VariantName)
	if !found {
		if caseExists {
			return unavailableBaseline(*ref, "variant-not-comparable"), nil
		}
		return unavailableBaseline(*ref, "case-not-in-baseline"), nil
	}

	sameInput := reflect.DeepEqual(cell.Input, baselineCell.Input)
	sameCase := cell.CaseID == baselineCell.CaseID
	baselineScores := evidenceScores(baselineCell.Scores)
	return api.QualityBaselineEvidence{
		Kind:         "available",
		BaselineID:   ref.BaselineID,
		ExperimentID: ref.ExperimentID,
		SameInput:    &sameInput,
		SameCase:     &sameCase,
		BaselineCell: &api.QualityBaselineCellEvidence{
			Status: baselineCell.Status,
			Output: baselineCell.Output,
			Scores: baselineScores,
		},
		Deltas: baselineDeltas(scores, baselineScores),
	}, nil
}

func (s *Service) baselineRecordExists(ctx context.Context, evaluationID string) (bool, error) {
	_, found, err := s.BaselineRecordAPI(ctx, evaluationID)
	return found, err
}

func unavailableBaseline(ref api.QualityExperimentBaselineRef, reason string) api.QualityBaselineEvidence {
	return api.QualityBaselineEvidence{
		Kind:         "unavailable",
		BaselineID:   ref.BaselineID,
		ExperimentID: ref.ExperimentID,
		Reason:       reason,
	}
}

func findBaselineCell(
	cells []api.QualityExperimentCell,
	candidate api.QualityExperimentCell,
	baselineVariantName string,
) (api.QualityExperimentCell, bool, bool) {
	targetVariant := baselineVariantName
	if targetVariant == "" {
		targetVariant = candidate.VariantName
	}

	fallbackIndex := -1
	caseExists := false
	for index, cell := range cells {
		if cell.CaseID != candidate.CaseID {
			continue
		}
		caseExists = true
		if cell.VariantName != targetVariant {
			continue
		}
		if cell.Trial == candidate.Trial {
			return cell, true, true
		}
		if fallbackIndex < 0 {
			fallbackIndex = index
		}
	}
	if fallbackIndex >= 0 {
		return cells[fallbackIndex], true, true
	}
	return api.QualityExperimentCell{}, false, caseExists
}

func baselineDeltas(
	candidate []api.QualityScoreEvidence,
	baseline []api.QualityScoreEvidence,
) []api.QualityBaselineDelta {
	baselineByName := map[string]float64{}
	for _, score := range baseline {
		baselineByName[score.Name] = score.Score
	}

	deltas := make([]api.QualityBaselineDelta, 0, len(candidate))
	for _, score := range candidate {
		baselineScore, ok := baselineByName[score.Name]
		if !ok {
			continue
		}
		delta := roundEvidenceDelta(score.Score - baselineScore)
		deltas = append(deltas, api.QualityBaselineDelta{
			ScoreName: score.Name,
			Baseline:  baselineScore,
			Candidate: score.Score,
			Delta:     delta,
		})
	}
	return deltas
}

func applyBaselineDeltas(scores []api.QualityScoreEvidence, deltas []api.QualityBaselineDelta) {
	for index := range scores {
		for _, delta := range deltas {
			if scores[index].Name != delta.ScoreName {
				continue
			}
			value := delta.Delta
			scores[index].DeltaFromBaseline = &value
			break
		}
	}
}

func roundEvidenceDelta(value float64) float64 {
	const precision = 1_000_000_000_000
	return math.Round(value*precision) / precision
}
