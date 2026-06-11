package qualityfs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotAppliesCassetteIssueOverlay(t *testing.T) {
	dir := t.TempDir()
	fs := Open(dir)
	cassettePath := filepath.Join(dir, "cassettes", "sample.json")
	if err := os.MkdirAll(filepath.Dir(cassettePath), 0755); err != nil {
		t.Fatalf("mkdir cassette dir: %v", err)
	}
	if err := os.WriteFile(cassettePath, []byte(`{
  "mode": "replay",
  "entries": [
    {
      "id": "entry-1",
      "caseId": "case-1",
      "request": {"kind": "prompt", "targetId": "writer.prompt", "provider": "openai", "model": "gpt"},
      "response": {},
      "recordedAt": "2026-06-11T10:00:00Z"
    }
  ]
}
`), 0644); err != nil {
		t.Fatalf("write cassette: %v", err)
	}
	if _, err := Put(fs, CassetteIssue{
		Path:     cassettePath,
		EntryID:  "entry-1",
		Kind:     "prompt",
		TargetID: "writer.prompt",
		Status:   "mismatch",
		Reason:   "signature changed",
	}); err != nil {
		t.Fatalf("put cassette issue: %v", err)
	}

	snapshot, err := fs.Snapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snapshot.Cassettes) != 1 {
		t.Fatalf("cassette count = %d, want 1", len(snapshot.Cassettes))
	}
	cassette := snapshot.Cassettes[0]
	if cassette.Status != "mismatch" {
		t.Fatalf("cassette status = %q, want mismatch", cassette.Status)
	}
	if cassette.Coverage != 0 {
		t.Fatalf("cassette coverage = %v, want 0", cassette.Coverage)
	}
	if cassette.HitRate != 0 {
		t.Fatalf("cassette hit rate = %v, want 0", cassette.HitRate)
	}
	if got := snapshot.ByTarget.CassettePaths["writer.prompt"]; len(got) != 1 || got[0] != cassettePath {
		t.Fatalf("cassette target join = %#v, want [%q]", got, cassettePath)
	}
}
