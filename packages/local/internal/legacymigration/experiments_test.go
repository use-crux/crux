package legacymigration

import (
	"os"
	"path/filepath"
	"testing"
)

func TestArchiveExperimentsIsAtomicAndRestartSafe(t *testing.T) {
	inspectDir := t.TempDir()
	source := filepath.Join(inspectDir, "experiments")
	if err := os.MkdirAll(source, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "legacy.json"), []byte(`{"schemaVersion":2}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ArchiveExperiments(inspectDir); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(inspectDir, "legacy", "experiments-v2")
	if _, err := os.Stat(filepath.Join(destination, "legacy.json")); err != nil {
		t.Fatalf("archived record: %v", err)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source still exists: %v", err)
	}
	if err := ArchiveExperiments(inspectDir); err != nil {
		t.Fatalf("restart: %v", err)
	}
	if _, err := os.Stat(filepath.Join(inspectDir, "legacy", "migration-v1.json")); err != nil {
		t.Fatalf("marker: %v", err)
	}
}

func TestArchiveExperimentsCompletesMarkerAfterRenameOnlyCrash(t *testing.T) {
	inspectDir := t.TempDir()
	destination := filepath.Join(inspectDir, "legacy", "experiments-v2")
	if err := os.MkdirAll(destination, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ArchiveExperiments(inspectDir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(inspectDir, "legacy", "migration-v1.json")); err != nil {
		t.Fatalf("marker: %v", err)
	}
}

func TestArchiveExperimentsLeavesCassettesUntouched(t *testing.T) {
	inspectDir := t.TempDir()
	cassette := filepath.Join(inspectDir, "cassettes", "keep.json")
	if err := os.MkdirAll(filepath.Dir(cassette), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cassette, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ArchiveExperiments(inspectDir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cassette); err != nil {
		t.Fatalf("cassette changed: %v", err)
	}
}
