package qualityfs

import (
	"encoding/json"
	"path/filepath"
)

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
