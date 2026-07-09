package qualityfs

import "encoding/json"

func (f *FS) readExperiments() ([]Experiment, error) {
	raw, err := f.readRecords(KindExperiments)
	if err != nil {
		return nil, err
	}
	records := make([]Experiment, 0, len(raw))
	for _, item := range raw {
		record, err := parseSnapshotExperiment(item)
		if err != nil {
			return nil, err
		}
		records = append(records, enrichExperiment(record))
	}
	return records, nil
}

func (f *FS) readSuites() ([]Suite, error) {
	raw, err := f.readRecords(KindSuites)
	if err != nil {
		return nil, err
	}
	records := make([]Suite, 0, len(raw))
	for _, item := range raw {
		var record Suite
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		records = append(records, normalizeSuite(record))
	}
	return records, nil
}

func (f *FS) readBaselines() ([]Baseline, error) {
	raw, err := f.readRecords(KindBaselines)
	if err != nil {
		return nil, err
	}
	records := make([]Baseline, 0, len(raw))
	for _, item := range raw {
		record, err := parseSnapshotBaseline(item)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

func (f *FS) readComparisons() ([]Comparison, error) {
	raw, err := f.readRecords(KindComparisons)
	if err != nil {
		return nil, err
	}
	records := make([]Comparison, 0, len(raw))
	for _, item := range raw {
		var record Comparison
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

func parseSnapshotExperiment(raw json.RawMessage) (Experiment, error) {
	if hasSchemaVersion(raw) {
		var record ExperimentRecord
		if err := json.Unmarshal(raw, &record); err != nil {
			return Experiment{}, err
		}
		return experimentFromSpec(record), nil
	}
	var record Experiment
	if err := json.Unmarshal(raw, &record); err != nil {
		return Experiment{}, err
	}
	return record, nil
}

func experimentFromSpec(record ExperimentRecord) Experiment {
	experiment := Experiment{
		Tag:          "QualityExperiment",
		ID:           record.ExperimentID,
		EvaluationID: record.EvaluationID,
		QualityID:    record.QualityID,
		StartedAt:    record.StartedAt,
		EndedAt:      record.EndedAt,
		Status:       "completed",
		Summary:      experimentSummaryFromSpec(record),
		Variants:     experimentVariantsFromSpec(record),
		Cells:        experimentCasesFromSpec(record.Cells),
	}
	if record.FilteredRun {
		experiment.Status = "filtered"
	}
	return experiment
}

func experimentSummaryFromSpec(record ExperimentRecord) ExperimentSummary {
	summary := ExperimentSummary{}
	for _, aggregate := range record.Aggregates.PerVariant {
		summary.Total += aggregate.Cells
		summary.Passed += aggregate.Passed
		summary.Failed += aggregate.Failed
		summary.Errored += aggregate.Errored
	}
	if summary.Total > 0 {
		return summary
	}
	for _, cell := range record.Cells {
		summary.Total++
		switch cell.Status {
		case "passed", "success":
			summary.Passed++
		case "errored", "error":
			summary.Errored++
		default:
			summary.Failed++
		}
	}
	return summary
}

func experimentVariantsFromSpec(record ExperimentRecord) []ExperimentVariant {
	variants := make([]ExperimentVariant, 0, len(record.Variants))
	for _, variant := range record.Variants {
		entry := ExperimentVariant{
			ID:       variant.Name,
			TargetID: record.EvaluationID,
			Label:    variant.Name,
		}
		if aggregate, ok := record.Aggregates.PerVariant[variant.Name]; ok {
			passRate := aggregate.PassRate
			entry.PassRate = &passRate
		}
		variants = append(variants, entry)
	}
	return variants
}

func experimentCasesFromSpec(cells []SpecExperimentCell) []ExperimentCase {
	cases := make([]ExperimentCase, 0, len(cells))
	for _, cell := range cells {
		cases = append(cases, ExperimentCase{
			CaseID:     cell.CaseID,
			CaseName:   cell.CaseName,
			VariantID:  cell.VariantName,
			Status:     cell.Status,
			DurationMs: cell.DurationMs,
			Scores:     scoresFromSpec(cell.Scores),
			TraceID:    firstString(cell.TraceIDs),
			Input:      cell.Input,
			Output:     cell.Output,
			Error:      cell.Error,
		})
	}
	return cases
}

func scoresFromSpec(scores []SpecCellScore) []Score {
	out := make([]Score, 0, len(scores))
	for _, score := range scores {
		out = append(out, Score{
			Kind:  "numeric",
			Name:  score.Name,
			Value: score.Score,
		})
	}
	return out
}

func parseSnapshotBaseline(raw json.RawMessage) (Baseline, error) {
	if hasSchemaVersion(raw) {
		var record SpecBaselineRecord
		if err := json.Unmarshal(raw, &record); err != nil {
			return Baseline{}, err
		}
		return baselineFromSpec(record), nil
	}
	var record Baseline
	if err := json.Unmarshal(raw, &record); err != nil {
		return Baseline{}, err
	}
	return record, nil
}

func baselineFromSpec(record SpecBaselineRecord) Baseline {
	var variantID *string
	if record.VariantName != "" {
		value := record.VariantName
		variantID = &value
	}
	return Baseline{
		Tag:          "QualityBaseline",
		ID:           record.BaselineID,
		QualityID:    record.EvaluationID,
		ExperimentID: record.ExperimentID,
		VariantID:    variantID,
		PromotedAt:   record.PromotedAt,
	}
}

func firstString(values []string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
