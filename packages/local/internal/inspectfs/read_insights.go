package inspectfs

import (
	"encoding/json"
	"path/filepath"
)

// InsightState contains only Inspect-owned persistence. Loading it never reads
// unrelated Eval, Baseline, or Review records.
type InsightState struct {
	Statuses map[string]InsightStatus
	Silences []InsightSilence
}

// ReadInsightState loads the status and silence streams used by Inspect.
func (f *FS) ReadInsightState() (InsightState, error) {
	statuses, err := f.readInsightStatuses()
	if err != nil {
		return InsightState{}, err
	}
	silences, err := f.readInsightSilences(false)
	if err != nil {
		return InsightState{}, err
	}
	return InsightState{Statuses: statuses, Silences: silences}, nil
}

// ReadInsightSilences loads active Inspect silence records without opening
// other persisted artifacts.
func (f *FS) ReadInsightSilences(includeDeleted bool) ([]InsightSilence, error) {
	return f.readInsightSilences(includeDeleted)
}

func (f *FS) readInsightStatuses() (map[string]InsightStatus, error) {
	raw, err := readJSONLines(filepath.Join(f.dir, filepath.FromSlash(string(StreamInsightStatuses))))
	if err != nil {
		return nil, err
	}
	records := map[string]InsightStatus{}
	for _, item := range raw {
		var record InsightStatus
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		if record.InsightID != "" {
			records[record.InsightID] = record
		}
	}
	return records, nil
}

func (f *FS) readInsightSilences(includeDeleted bool) ([]InsightSilence, error) {
	raw, err := readJSONLines(filepath.Join(f.dir, filepath.FromSlash(string(StreamInsightSilences))))
	if err != nil {
		return nil, err
	}
	byID := map[string]InsightSilence{}
	order := []string{}
	for _, item := range raw {
		var record InsightSilence
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		if record.ID == "" {
			continue
		}
		if _, exists := byID[record.ID]; !exists {
			order = append(order, record.ID)
		}
		byID[record.ID] = record
	}
	records := make([]InsightSilence, 0, len(order))
	for _, id := range order {
		record := byID[id]
		if !includeDeleted && record.DeletedAt != "" {
			continue
		}
		records = append(records, record)
	}
	return records, nil
}
