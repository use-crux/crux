package cache

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectIndexSnapshotCacheEpochOwnsGoSnapshotContract(t *testing.T) {
	if ProjectIndexSnapshotCacheEpoch != 47 {
		t.Fatalf("ProjectIndexSnapshotCacheEpoch = %d, want prompt-text source-ref epoch 47", ProjectIndexSnapshotCacheEpoch)
	}

	doc := exportedConstDoc(t, "identity.go", "ProjectIndexSnapshotCacheEpoch")
	normalizedDoc := strings.Join(strings.Fields(doc), " ")
	for _, phrase := range []string{
		"persisted `.crux/cache/index-v2/epoch-*`",
		"stale snapshot masking after restart",
		"Eval arm placement and embedding facts",
		"unconditional Rust/Oxc Static Index scheduling",
		"Workspace snapshot usage relations",
		"Epoch 46",
		"retained lint suppression evidence",
		"direct named-export evidence",
		"Epoch 47",
		"prompt-text source-ref metadata",
		"TS-owned AST and semantic fact cache identity",
	} {
		if !strings.Contains(normalizedDoc, phrase) {
			t.Fatalf("ProjectIndexSnapshotCacheEpoch doc = %q, missing %q", doc, phrase)
		}
	}
}

func TestProjectIndexFactStorePathIncludesSnapshotEpoch(t *testing.T) {
	root := t.TempDir()
	wantSuffix := filepath.Join(".crux", "cache", "index-v2", "epoch-47", "index.db")

	if got := projectIndexFactStoreDBFile(root); !strings.HasSuffix(got, wantSuffix) {
		t.Fatalf("projectIndexFactStoreDBFile() = %q, want suffix %q", got, wantSuffix)
	}
}

func TestProjectIndexFactStoreMissesPrePromptTextSnapshotEpoch(t *testing.T) {
	root := t.TempDir()
	oldPath := filepath.Join(root, ".crux", "cache", "index-v2", "epoch-46", "index.db")
	if err := os.MkdirAll(filepath.Dir(oldPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldPath, []byte("pre-prompt-text snapshot"), 0o600); err != nil {
		t.Fatal(err)
	}

	currentPath := projectIndexFactStoreDBFile(root)
	if currentPath == oldPath {
		t.Fatalf("current snapshot path = old epoch path %q", currentPath)
	}
	if _, err := os.Stat(currentPath); !os.IsNotExist(err) {
		t.Fatalf("current snapshot path stat error = %v, want cache miss", err)
	}
}

func exportedConstDoc(t *testing.T, filename string, constName string) string {
	t.Helper()

	file, err := parser.ParseFile(token.NewFileSet(), filename, nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("parse %s: %v", filename, err)
	}
	for _, decl := range file.Decls {
		genDecl, ok := decl.(*ast.GenDecl)
		if !ok || genDecl.Tok != token.CONST {
			continue
		}
		for _, spec := range genDecl.Specs {
			valueSpec, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for _, name := range valueSpec.Names {
				if name.Name == constName && genDecl.Doc != nil {
					return genDecl.Doc.Text()
				}
			}
		}
	}
	t.Fatalf("const %s missing from %s", constName, filename)
	return ""
}
