package staticsource

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticplan"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

func writeFixtureFile(t testing.TB, root, name, source string) string {
	t.Helper()
	file := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("mkdir fixture dir: %v", err)
	}
	if err := os.WriteFile(file, []byte(source), 0o600); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}
	return file
}

func writeManifest(t testing.TB, root string, entry map[string]any) {
	t.Helper()
	data, err := json.Marshal(entry)
	if err != nil {
		t.Fatalf("marshal manifest entry: %v", err)
	}
	file := filepath.Join(root, ".crux", "cache", "index", "static-parse-v38", "manifest.jsonl")
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("mkdir manifest dir: %v", err)
	}
	if err := os.WriteFile(file, append(data, '\n'), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
}

func fixtureHash(t testing.TB, file string) string {
	t.Helper()
	source, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return fmt.Sprintf("%x", sha256.Sum256(source))
}

func compilerInputsFixture(t testing.TB) []json.RawMessage {
	t.Helper()
	return staticplan.DefaultCacheCompilerInputs()
}

func containsPreparedFile(files []staticprotocol.SourceFile, want string) bool {
	for _, file := range files {
		if file.File == want && file.SourceHash != "" {
			return true
		}
	}
	return false
}
