package inspectfs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

func readJSONLines(path string) ([]json.RawMessage, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []json.RawMessage{}, nil
		}
		return nil, err
	}
	records := []json.RawMessage{}
	for lineNumber, line := range bytes.Split(content, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		var raw json.RawMessage
		if err := json.Unmarshal(line, &raw); err != nil {
			return nil, fmt.Errorf("%s line %d: %w", path, lineNumber+1, err)
		}
		records = append(records, append(json.RawMessage(nil), raw...))
	}
	return records, nil
}

func appendJSONLine(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.Write(append(data, '\n'))
	return err
}
