package qualityfs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func (f *FS) ReadRaw(kind Kind, id string) (json.RawMessage, bool, error) {
	if f == nil {
		f = Open("")
	}
	content, err := os.ReadFile(filepath.Join(f.dir, string(kind), SafeFileName(id)+".json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	var raw json.RawMessage
	if err := json.Unmarshal(content, &raw); err != nil {
		return nil, false, err
	}
	return rawClone(raw), true, nil
}

func (f *FS) ReadStream(stream Stream) ([]json.RawMessage, error) {
	if f == nil {
		f = Open("")
	}
	return readJSONLines(filepath.Join(f.dir, filepath.FromSlash(string(stream))))
}

func (f *FS) readRecords(kind Kind) ([]json.RawMessage, error) {
	recordsDir := filepath.Join(f.dir, string(kind))
	entries, err := os.ReadDir(recordsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []json.RawMessage{}, nil
		}
		return nil, err
	}
	records := make([]json.RawMessage, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(recordsDir, entry.Name()))
		if err != nil {
			return nil, err
		}
		var raw json.RawMessage
		if err := json.Unmarshal(content, &raw); err != nil {
			return nil, err
		}
		records = append(records, rawClone(raw))
	}
	return records, nil
}

func (f *FS) writeRecord(kind Kind, id string, record any) error {
	if id == "" {
		return fmt.Errorf("id is required")
	}
	recordsDir := filepath.Join(f.dir, string(kind))
	if err := os.MkdirAll(recordsDir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(recordsDir, SafeFileName(id)+".json"), append(data, '\n'))
}

func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	tmp, err := os.CreateTemp(dir, base+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	committed = true
	fsyncDirBestEffort(dir)
	return nil
}

func fsyncDirBestEffort(dir string) {
	handle, err := os.Open(dir)
	if err != nil {
		return
	}
	defer handle.Close()
	_ = handle.Sync()
}

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
		records = append(records, rawClone(raw))
	}
	return records, nil
}

func appendJSONLine(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer file.Close()
	line := append(data, '\n')
	_, err = file.Write(line)
	return err
}
