package evalfs

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestReadRunPreservesSharedGoldenBytesAndUnknownFields(t *testing.T) {
	fixture := sharedGoldenPath(t)
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	runsDir := filepath.Join(root, ".crux", "quality", "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(runsDir, "eval-run-golden.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	run, found, err := OpenProject(root).ReadRun("eval-run-golden")
	if err != nil || !found {
		t.Fatalf("ReadRun: found=%v err=%v", found, err)
	}
	if run.SchemaVersion != 3 || run.Status != "complete" || !run.Passed {
		t.Fatalf("unexpected known fields: %+v", run)
	}
	if !bytes.Equal(run.Raw, raw) {
		t.Fatal("raw future-additive record changed during read")
	}
	if !bytes.Contains(run.Raw, []byte(`"futureTopLevelField"`)) ||
		!bytes.Contains(run.Raw, []byte(`"futureCellField"`)) {
		t.Fatal("unknown additive fields were not preserved")
	}
}

func TestReadRunRejectsIncompletePassingRecord(t *testing.T) {
	root := t.TempDir()
	runsDir := filepath.Join(root, ".crux", "quality", "runs")
	if err := os.MkdirAll(runsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	bad := []byte(`{"schemaVersion":3,"runId":"bad","evalId":"support","status":"incomplete","passed":true}`)
	if err := os.WriteFile(filepath.Join(runsDir, "bad.json"), bad, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := OpenProject(root).ReadRun("bad"); err == nil {
		t.Fatal("expected corrupt incomplete run error")
	}
}

func TestParseBaselinePreservesSharedGoldenBytes(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	path := filepath.Clean(filepath.Join(
		filepath.Dir(file), "..", "..", "..", "core", "__tests__", "eval",
		"fixtures", "baseline-v3.golden.json",
	))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	baseline, err := ParseBaseline(raw)
	if err != nil {
		t.Fatal(err)
	}
	if baseline.BaselineID != "baseline-golden" || !bytes.Equal(raw, baseline.Raw) {
		t.Fatal("Baseline known identity or raw additive bytes changed")
	}
	if !bytes.Contains(baseline.Raw, []byte(`"futureBaselineField"`)) {
		t.Fatal("unknown Baseline field was not preserved")
	}
}

func sharedGoldenPath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	return filepath.Clean(filepath.Join(
		filepath.Dir(file), "..", "..", "..", "core", "__tests__", "eval",
		"fixtures", "run-v3.golden.json",
	))
}
