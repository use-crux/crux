package qualityfs

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

const specBaseline = `{
  "schemaVersion": 1,
  "baselineId": "01KTBASELINE000000000000000",
  "evaluationId": "support.refunds",
  "experimentId": "01KTPROMOTED000000000000000",
  "variantName": "current",
  "promotedAt": "2026-06-12T20:00:00.000Z",
  "promotedBy": "henri",
  "configFingerprint": "cf-promoted",
  "reference": {
    "refund-after-60-days": { "pass": 1, "helpful": 0.84 }
  }
}`

const legacyBaseline = `{
  "_tag": "QualityBaseline",
  "id": "baseline-legacy",
  "qualityId": "demo",
  "experimentId": "exp-legacy-1",
  "promotedAt": "2026-06-01T00:00:00.000Z",
  "summary": {}
}`

// Mirrors a real engine cassette (Karyla mode-auto-detect.json): version 1,
// metadata{recordedAt,sdkVersion,models}, keyed entries.
const specCassette = `{
  "version": 1,
  "metadata": {
    "recordedAt": "2026-06-12T21:41:07.070Z",
    "sdkVersion": "0.1.0",
    "models": ["openrouter/google/gemini-3.1-flash-lite-preview"]
  },
  "entries": {
    "8ca8ba45": { "kind": "structured", "call": {}, "result": {}, "recordedAt": "2026-06-12T21:41:07.070Z" },
    "1f00aa12": { "kind": "loop", "call": {}, "result": {}, "recordedAt": "2026-06-12T21:41:08.000Z" }
  }
}`

const staleCassette = `{
  "version": 1,
  "metadata": { "recordedAt": "2026-01-01T00:00:00.000Z", "sdkVersion": "0.1.0", "models": [] },
  "entries": {}
}`

func TestReadBaselineRecords(t *testing.T) {
	dir := t.TempDir()
	baseDir := filepath.Join(dir, "baselines")
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"support.refunds.json": specBaseline,
		"baseline-legacy.json": legacyBaseline,
	} {
		if err := os.WriteFile(filepath.Join(baseDir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fs := Open(dir)

	records, legacySkipped, err := fs.ReadBaselineRecords()
	if err != nil {
		t.Fatal(err)
	}
	if legacySkipped != 1 {
		t.Errorf("legacySkipped = %d, want 1", legacySkipped)
	}
	if len(records) != 1 {
		t.Fatalf("got %d records, want 1", len(records))
	}
	record := records[0].Record
	if record.BaselineID != "01KTBASELINE000000000000000" ||
		record.EvaluationID != "support.refunds" ||
		record.VariantName != "current" ||
		record.PromotedBy != "henri" ||
		record.ConfigFingerprint != "cf-promoted" {
		t.Errorf("record: %+v", record)
	}
	if record.Reference["refund-after-60-days"]["helpful"] != 0.84 {
		t.Errorf("reference: %+v", record.Reference)
	}
	if string(records[0].Raw) != specBaseline {
		t.Error("Raw must be the verbatim stored bytes")
	}

	raw, found, err := fs.ReadBaselineRecordRaw("support.refunds")
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if string(raw) != specBaseline {
		t.Error("detail raw differs from stored bytes")
	}
	if _, found, _ := fs.ReadBaselineRecordRaw("baseline-legacy"); found {
		t.Error("legacy baseline must not resolve")
	}
}

func TestReadCassetteFiles(t *testing.T) {
	dir := t.TempDir()
	cassDir := filepath.Join(dir, "cassettes")
	if err := os.MkdirAll(cassDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"mode-auto-detect.json": specCassette,
		"old-recording.json":    staleCassette,
		"issues.jsonl":          `{"kind":"legacy-issue"}`,
		"not-a-cassette.json":   `{"foo":"bar"}`,
	} {
		if err := os.WriteFile(filepath.Join(cassDir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	fs := Open(dir)

	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	infos, err := fs.ReadCassetteFiles(now)
	if err != nil {
		t.Fatal(err)
	}
	if len(infos) != 2 {
		t.Fatalf("got %d cassettes, want 2 (issues.jsonl and non-cassette json skipped): %+v", len(infos), infos)
	}

	fresh := infos[0]
	if fresh.Name != "mode-auto-detect" {
		t.Fatalf("order: %+v", infos)
	}
	if fresh.EntryCount != 2 || fresh.SdkVersion != "0.1.0" || fresh.Stale {
		t.Errorf("fresh cassette: %+v", fresh)
	}
	if len(fresh.Models) != 1 || fresh.Models[0] != "openrouter/google/gemini-3.1-flash-lite-preview" {
		t.Errorf("models: %+v", fresh.Models)
	}
	if fresh.SizeBytes <= 0 {
		t.Errorf("sizeBytes: %d", fresh.SizeBytes)
	}

	stale := infos[1]
	if stale.Name != "old-recording" || !stale.Stale {
		t.Errorf("stale cassette (recorded >90d before now) must flag Stale: %+v", stale)
	}
	if stale.EntryCount != 0 || stale.Models == nil {
		t.Errorf("stale cassette fields: %+v", stale)
	}
}

func TestReadCassetteFilesToleratesMissingDir(t *testing.T) {
	infos, err := Open(t.TempDir()).ReadCassetteFiles(time.Now())
	if err != nil {
		t.Fatalf("missing cassettes dir must not error: %v", err)
	}
	if len(infos) != 0 {
		t.Errorf("want empty, got %+v", infos)
	}
}
