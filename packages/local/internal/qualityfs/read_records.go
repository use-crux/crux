package qualityfs

import "encoding/json"

func (f *FS) readExperiments() ([]Experiment, error) {
	raw, err := f.readRecords(KindExperiments)
	if err != nil {
		return nil, err
	}
	records := make([]Experiment, 0, len(raw))
	for _, item := range raw {
		var record Experiment
		if err := json.Unmarshal(item, &record); err != nil {
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
		var record Baseline
		if err := json.Unmarshal(item, &record); err != nil {
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
