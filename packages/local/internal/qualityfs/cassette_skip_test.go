package qualityfs

import (
	"os"
	"path/filepath"
	"testing"
)

// Regression: the engine's executor cassettes (`entries` is an OBJECT keyed
// by call hash) live in the same `cassettes/` dir as legacy workbench
// cassettes (`entries` is an ARRAY). The legacy reader must SKIP files it
// cannot parse instead of failing — one new-format file was poisoning the
// entire Snapshot and 500ing overview/experiments/insights/runs.
func TestReadCassettesSkipsNewFormatExecutorCassettes(t *testing.T) {
	dir := t.TempDir()
	cassettesDir := filepath.Join(dir, "cassettes")
	if err := os.MkdirAll(cassettesDir, 0o755); err != nil {
		t.Fatal(err)
	}
	newFormat := `{
	  "version": 1,
	  "metadata": { "recordedAt": "2026-06-12T21:41:07.070Z", "sdkVersion": "0.1.0", "models": [] },
	  "entries": { "8ca8ba45": { "kind": "structured", "call": {}, "result": {}, "recordedAt": "2026-06-12T21:41:07.070Z" } }
	}`
	legacyFormat := `{
	  "mode": "replay",
	  "entries": [ { "id": "e1", "caseId": "c1", "request": { "kind": "generate" }, "response": {}, "recordedAt": "2026-06-01T00:00:00.000Z" } ]
	}`
	if err := os.WriteFile(filepath.Join(cassettesDir, "mode-auto-detect.json"), []byte(newFormat), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cassettesDir, "legacy.cassette.json"), []byte(legacyFormat), 0o644); err != nil {
		t.Fatal(err)
	}

	fs := Open(dir)
	cassettes, err := fs.readCassettes()
	if err != nil {
		t.Fatalf("a new-format cassette must not fail the legacy reader: %v", err)
	}
	if len(cassettes) != 1 {
		t.Fatalf("got %d legacy cassettes, want 1 (new-format skipped): %+v", len(cassettes), cassettes)
	}

	// The full snapshot — what overview/experiments/insights/runs read —
	// must survive too.
	snapshot, err := fs.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot must not be poisoned by a new-format cassette: %v", err)
	}
	if len(snapshot.Cassettes) != 1 {
		t.Errorf("snapshot cassettes = %d, want 1", len(snapshot.Cassettes))
	}
}
