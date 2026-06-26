package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadOrCreateIngestTokenPersistsProjectToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".crux", "devtools", "ingest-token")

	first, firstPath, err := loadOrCreateIngestToken(path)
	if err != nil {
		t.Fatalf("load first token: %v", err)
	}
	if first == "" {
		t.Fatal("first token is empty")
	}
	if firstPath != path {
		t.Fatalf("first path = %q, want %q", firstPath, path)
	}

	second, secondPath, err := loadOrCreateIngestToken(path)
	if err != nil {
		t.Fatalf("load second token: %v", err)
	}
	if second != first {
		t.Fatalf("second token = %q, want persisted token %q", second, first)
	}
	if secondPath != path {
		t.Fatalf("second path = %q, want %q", secondPath, path)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat token file: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("token file mode = %v, want 0600", info.Mode().Perm())
	}
}
