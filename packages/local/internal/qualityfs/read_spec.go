package qualityfs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Readers for the spec-02 records the Quality engine writes. They live
// alongside the legacy readers (read_records.go) but never share parsing:
// a spec record is recognized by its `schemaVersion` field; files without
// one (legacy demo seeds, pre-rewrite records) are skipped and counted —
// NOT lossily coerced into either shape.

// ExperimentRecordFile pairs the parsed presentation view of a record with
// its verbatim stored bytes. Endpoints that serve a record whole must use
// Raw: the schema evolves additively and a struct round-trip would drop
// fields newer than this binary.
type ExperimentRecordFile struct {
	Record ExperimentRecord
	Raw    json.RawMessage
}

type schemaVersionProbe struct {
	SchemaVersion *int `json:"schemaVersion"`
}

func hasSchemaVersion(content []byte) bool {
	var probe schemaVersionProbe
	if err := json.Unmarshal(content, &probe); err != nil {
		return false
	}
	return probe.SchemaVersion != nil
}

// ReadExperimentRecords loads every spec-02 experiment record under
// `experiments/`, newest first (experiment ids are ULIDs — lexically
// time-sorted). The second return is the number of non-spec (legacy) files
// skipped, surfaced so callers can report rather than silently ignore them.
func (f *FS) ReadExperimentRecords() ([]ExperimentRecordFile, int, error) {
	if f == nil {
		f = Open("")
	}
	recordsDir := filepath.Join(f.dir, string(KindExperiments))
	entries, err := os.ReadDir(recordsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ExperimentRecordFile{}, 0, nil
		}
		return nil, 0, err
	}
	records := make([]ExperimentRecordFile, 0, len(entries))
	legacySkipped := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(recordsDir, entry.Name()))
		if err != nil {
			return nil, 0, err
		}
		if !hasSchemaVersion(content) {
			legacySkipped++
			continue
		}
		var record ExperimentRecord
		if err := json.Unmarshal(content, &record); err != nil {
			legacySkipped++
			continue
		}
		records = append(records, ExperimentRecordFile{Record: record, Raw: content})
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].Record.ExperimentID > records[j].Record.ExperimentID
	})
	return records, legacySkipped, nil
}

// ReadExperimentRecordRaw returns the verbatim stored bytes of one spec-02
// experiment record. The id is used as the filename verbatim (engine ULIDs
// are uppercase; SafeFileName would mangle them) with traversal guarding.
// Legacy (no schemaVersion) files do not resolve through this reader.
func (f *FS) ReadExperimentRecordRaw(experimentID string) (json.RawMessage, bool, error) {
	return f.readSpecRaw(KindExperiments, experimentID)
}

func (f *FS) readSpecRaw(kind Kind, id string) (json.RawMessage, bool, error) {
	if f == nil {
		f = Open("")
	}
	if id == "" || id != filepath.Base(id) || strings.ContainsAny(id, "/\\") || strings.Contains(id, "..") {
		return nil, false, nil
	}
	content, err := os.ReadFile(filepath.Join(f.dir, string(kind), id+".json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, err
	}
	if !hasSchemaVersion(content) {
		return nil, false, nil
	}
	return content, true, nil
}

// BaselineRecordFile pairs a parsed spec-02 baseline record with its
// verbatim stored bytes.
type BaselineRecordFile struct {
	Record SpecBaselineRecord
	Raw    json.RawMessage
}

// ReadBaselineRecords loads every spec-02 baseline record under
// `baselines/`, newest promotion first. Legacy baseline files are skipped
// and counted, mirroring ReadExperimentRecords.
func (f *FS) ReadBaselineRecords() ([]BaselineRecordFile, int, error) {
	if f == nil {
		f = Open("")
	}
	recordsDir := filepath.Join(f.dir, string(KindBaselines))
	entries, err := os.ReadDir(recordsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []BaselineRecordFile{}, 0, nil
		}
		return nil, 0, err
	}
	records := make([]BaselineRecordFile, 0, len(entries))
	legacySkipped := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(recordsDir, entry.Name()))
		if err != nil {
			return nil, 0, err
		}
		if !hasSchemaVersion(content) {
			legacySkipped++
			continue
		}
		var record SpecBaselineRecord
		if err := json.Unmarshal(content, &record); err != nil {
			legacySkipped++
			continue
		}
		records = append(records, BaselineRecordFile{Record: record, Raw: content})
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].Record.PromotedAt > records[j].Record.PromotedAt
	})
	return records, legacySkipped, nil
}

// ReadBaselineRecordRaw returns the verbatim bytes of the committed baseline
// for one evaluation id (the spec-02 filename rule: clean ids map to
// `baselines/<evaluationId>.json` verbatim).
func (f *FS) ReadBaselineRecordRaw(evaluationID string) (json.RawMessage, bool, error) {
	return f.readSpecRaw(KindBaselines, evaluationID)
}

// CassetteStaleAfter mirrors the engine's 90-day staleness window
// (core quality/internal/cassette.ts STALE_AFTER_DAYS).
const CassetteStaleAfter = 90 * 24 * time.Hour

// CassetteFileInfo is the read-model view of one executor-boundary cassette:
// metadata and entry count only — entries carry recorded model output and are
// deliberately not exposed in bulk.
type CassetteFileInfo struct {
	Name       string
	Path       string
	RecordedAt string
	SdkVersion string
	Models     []string
	EntryCount int
	Stale      bool
	SizeBytes  int64
}

// ReadCassetteFiles lists the engine's cassette files under `cassettes/`,
// flagging records older than the engine's staleness window relative to now.
// Non-cassette files in the directory (e.g. legacy issues.jsonl) are ignored.
func (f *FS) ReadCassetteFiles(now time.Time) ([]CassetteFileInfo, error) {
	if f == nil {
		f = Open("")
	}
	cassettesDir := filepath.Join(f.dir, "cassettes")
	entries, err := os.ReadDir(cassettesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []CassetteFileInfo{}, nil
		}
		return nil, err
	}
	infos := make([]CassetteFileInfo, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(cassettesDir, entry.Name())
		content, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var file struct {
			CassetteFileRecord
			Entries map[string]json.RawMessage `json:"entries"`
		}
		if err := json.Unmarshal(content, &file); err != nil || file.Version != 1 {
			continue
		}
		stale := false
		if recordedAt, parseErr := time.Parse(time.RFC3339, file.Metadata.RecordedAt); parseErr == nil {
			stale = now.Sub(recordedAt) > CassetteStaleAfter
		}
		models := file.Metadata.Models
		if models == nil {
			models = []string{}
		}
		info, statErr := entry.Info()
		var sizeBytes int64
		if statErr == nil {
			sizeBytes = info.Size()
		}
		infos = append(infos, CassetteFileInfo{
			Name:       strings.TrimSuffix(entry.Name(), ".json"),
			Path:       path,
			RecordedAt: file.Metadata.RecordedAt,
			SdkVersion: file.Metadata.SdkVersion,
			Models:     models,
			EntryCount: len(file.Entries),
			Stale:      stale,
			SizeBytes:  sizeBytes,
		})
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].Name < infos[j].Name })
	return infos, nil
}
