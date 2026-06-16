package qualityfs

import (
	"encoding/json"
	"path/filepath"
)

func (f *FS) readCassetteIssues() ([]CassetteIssue, error) {
	raw, err := readJSONLines(filepath.Join(f.dir, filepath.FromSlash(string(StreamCassetteIssues))))
	if err != nil {
		return nil, err
	}
	records := make([]CassetteIssue, 0, len(raw))
	for _, item := range raw {
		var record CassetteIssue
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}
