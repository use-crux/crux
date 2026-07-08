package quality

import (
	"context"
	"math"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

type QualityJudgeReport struct {
	SchemaVersion int                        `json:"schemaVersion"`
	EvaluationID  string                     `json:"evaluationId"`
	Scorers       []QualityJudgeReportScorer `json:"scorers"`
}

type QualityJudgeReportScorer struct {
	Name          string                           `json:"name"`
	Threshold     float64                          `json:"threshold"`
	Labeled       int                              `json:"labeled"`
	Confusion     QualityJudgeReportConfusion      `json:"confusion"`
	Agreement     float64                          `json:"agreement"`
	Precision     float64                          `json:"precision"`
	Recall        float64                          `json:"recall"`
	Kappa         *float64                         `json:"kappa"`
	Disagreements []QualityJudgeReportDisagreement `json:"disagreements"`
}

type QualityJudgeReportConfusion struct {
	TP int `json:"tp"`
	FP int `json:"fp"`
	FN int `json:"fn"`
	TN int `json:"tn"`
}

type QualityJudgeReportDisagreement struct {
	ExperimentID string  `json:"experimentId"`
	CaseID       string  `json:"caseId"`
	Variant      string  `json:"variant"`
	Trial        int     `json:"trial"`
	Human        string  `json:"human"`
	JudgeScore   float64 `json:"judgeScore"`
	Rationale    string  `json:"rationale,omitempty"`
}

type judgeReportAccumulator struct {
	name          string
	threshold     float64
	confusion     QualityJudgeReportConfusion
	disagreements []QualityJudgeReportDisagreement
}

func (s *Service) JudgeReportAPI(_ context.Context, evaluationID string) (QualityJudgeReport, bool, error) {
	fs := qualityfs.Open(s.dir)
	files, _, err := fs.ReadExperimentRecords()
	if err != nil {
		return QualityJudgeReport{}, false, err
	}
	snapshot, err := fs.Snapshot()
	if err != nil {
		return QualityJudgeReport{}, false, err
	}

	byName := map[string]*judgeReportAccumulator{}
	foundEvaluation := false
	for _, file := range files {
		record := file.Record
		if record.EvaluationID != evaluationID {
			continue
		}
		foundEvaluation = true
		thresholds := judgeReportThresholds(record)
		for _, label := range snapshot.Feedback {
			if !isHumanLabelForExperiment(label, record.ExperimentID) {
				continue
			}
			cell, ok := judgeReportCellForLabel(record.Cells, label)
			if !ok {
				continue
			}
			scoreNames := judgeReportScoreNames(label, cell)
			for _, scoreName := range scoreNames {
				score, ok := judgeReportScoreByName(cell, scoreName)
				if !ok || score.Score == nil {
					continue
				}
				acc := byName[scoreName]
				if acc == nil {
					acc = &judgeReportAccumulator{name: scoreName, threshold: thresholds[scoreName]}
					if acc.threshold == 0 {
						acc.threshold = 0.5
					}
					byName[scoreName] = acc
				}
				acc.add(record.ExperimentID, cell, label, score)
			}
		}
	}
	if !foundEvaluation {
		return QualityJudgeReport{}, false, nil
	}

	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	scorers := make([]QualityJudgeReportScorer, 0, len(names))
	for _, name := range names {
		scorers = append(scorers, byName[name].report())
	}
	return QualityJudgeReport{SchemaVersion: 1, EvaluationID: evaluationID, Scorers: scorers}, true, nil
}

func (a *judgeReportAccumulator) add(experimentID string, cell qualityfs.SpecExperimentCell, label qualityfs.Feedback, score qualityfs.SpecCellScore) {
	humanPass := label.Rating != nil && *label.Rating > 0
	predictedPass := *score.Score >= a.threshold
	switch {
	case predictedPass && humanPass:
		a.confusion.TP++
	case predictedPass && !humanPass:
		a.confusion.FP++
	case !predictedPass && humanPass:
		a.confusion.FN++
	default:
		a.confusion.TN++
	}
	if predictedPass != humanPass {
		a.disagreements = append(a.disagreements, QualityJudgeReportDisagreement{
			ExperimentID: experimentID,
			CaseID:       cell.CaseID,
			Variant:      cell.VariantName,
			Trial:        cell.Trial,
			Human:        humanVerdict(label),
			JudgeScore:   *score.Score,
			Rationale:    judgeReportRationale(score),
		})
	}
}

func (a *judgeReportAccumulator) report() QualityJudgeReportScorer {
	total := a.confusion.TP + a.confusion.FP + a.confusion.FN + a.confusion.TN
	agreement := ratio(float64(a.confusion.TP+a.confusion.TN), float64(total))
	precision := ratio(float64(a.confusion.TP), float64(a.confusion.TP+a.confusion.FP))
	recall := ratio(float64(a.confusion.TP), float64(a.confusion.TP+a.confusion.FN))
	return QualityJudgeReportScorer{
		Name:          a.name,
		Threshold:     a.threshold,
		Labeled:       total,
		Confusion:     a.confusion,
		Agreement:     agreement,
		Precision:     precision,
		Recall:        recall,
		Kappa:         cohenKappa(a.confusion),
		Disagreements: a.disagreements,
	}
}

func judgeReportThresholds(record qualityfs.ExperimentRecord) map[string]float64 {
	thresholds := map[string]float64{}
	for _, gate := range record.Gates.Results {
		if !strings.HasPrefix(gate.Gate, "scores.") || !strings.HasSuffix(gate.Gate, ".min") {
			continue
		}
		scoreName := strings.TrimSuffix(strings.TrimPrefix(gate.Gate, "scores."), ".min")
		if scoreName == "" {
			continue
		}
		if threshold, ok := numericAny(gate.Threshold); ok {
			thresholds[scoreName] = threshold
		}
	}
	return thresholds
}

func isHumanLabelForExperiment(label qualityfs.Feedback, experimentID string) bool {
	if label.ExperimentID == nil || *label.ExperimentID != experimentID || label.Rating == nil {
		return false
	}
	for _, tag := range label.Tags {
		if tag == "human-label" {
			return true
		}
	}
	return false
}

func judgeReportCellForLabel(cells []qualityfs.SpecExperimentCell, label qualityfs.Feedback) (qualityfs.SpecExperimentCell, bool) {
	if label.CaseID == nil {
		return qualityfs.SpecExperimentCell{}, false
	}
	variant := metadataString(label.Metadata, "variant", "default")
	trial := metadataInt(label.Metadata, "trial", 0)
	for _, cell := range cells {
		if cell.CaseID == *label.CaseID && cell.VariantName == variant && cell.Trial == trial {
			return cell, true
		}
	}
	return qualityfs.SpecExperimentCell{}, false
}

func judgeReportScoreNames(label qualityfs.Feedback, cell qualityfs.SpecExperimentCell) []string {
	if scoreName := metadataString(label.Metadata, "scoreName", ""); scoreName != "" {
		return []string{scoreName}
	}
	names := []string{}
	for _, score := range cell.Scores {
		if _, ok := score.Metadata["judge"]; ok {
			names = append(names, score.Name)
		}
	}
	return names
}

func judgeReportScoreByName(cell qualityfs.SpecExperimentCell, name string) (qualityfs.SpecCellScore, bool) {
	for _, score := range cell.Scores {
		if score.Name == name {
			return score, true
		}
	}
	return qualityfs.SpecCellScore{}, false
}

func judgeReportRationale(score qualityfs.SpecCellScore) string {
	if value, ok := score.Metadata["rationale"].(string); ok {
		return value
	}
	return ""
}

func humanVerdict(label qualityfs.Feedback) string {
	if label.Rating != nil && *label.Rating > 0 {
		return "pass"
	}
	return "fail"
}

func ratio(numerator float64, denominator float64) float64 {
	if denominator == 0 {
		return 0
	}
	return numerator / denominator
}

func cohenKappa(confusion QualityJudgeReportConfusion) *float64 {
	total := confusion.TP + confusion.FP + confusion.FN + confusion.TN
	if total == 0 {
		return nil
	}
	predictedPass := confusion.TP + confusion.FP
	predictedFail := confusion.FN + confusion.TN
	humanPass := confusion.TP + confusion.FN
	humanFail := confusion.FP + confusion.TN
	po := ratio(float64(confusion.TP+confusion.TN), float64(total))
	pe := (float64(predictedPass*humanPass) + float64(predictedFail*humanFail)) / math.Pow(float64(total), 2)
	if pe == 1 {
		return nil
	}
	value := (po - pe) / (1 - pe)
	return &value
}

func metadataString(metadata map[string]any, key string, fallback string) string {
	if value, ok := metadata[key].(string); ok {
		return value
	}
	return fallback
}

func metadataInt(metadata map[string]any, key string, fallback int) int {
	switch value := metadata[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	default:
		return fallback
	}
}

func numericAny(value any) (float64, bool) {
	switch typed := value.(type) {
	case int:
		return float64(typed), true
	case float64:
		return typed, true
	default:
		return 0, false
	}
}
