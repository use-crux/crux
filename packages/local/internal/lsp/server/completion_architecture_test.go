package server

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompletionGoBoundaryContainsNoFirstPartySlotTable(t *testing.T) {
	repoRoot, err := filepath.Abs(filepath.Join("..", "..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	roots := []string{
		filepath.Join(repoRoot, "packages", "local", "internal", "lsp"),
		filepath.Join(repoRoot, "packages", "local", "internal", "projectindex"),
	}
	for _, root := range roots {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil || entry.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") || !strings.Contains(filepath.Base(path), "completion") {
				return walkErr
			}
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			for _, forbidden := range []string{`"agent"`, `"prompt"`} {
				if strings.Contains(string(content), forbidden) {
					t.Fatalf("%s contains first-party slot literal %s; keep slot semantics in the compiler manifest", path, forbidden)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}
