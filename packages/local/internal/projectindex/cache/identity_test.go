package cache

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

func TestProjectIndexSnapshotCacheEpochOwnsGoSnapshotContract(t *testing.T) {
	if ProjectIndexSnapshotCacheEpoch != 19 {
		t.Fatalf("ProjectIndexSnapshotCacheEpoch = %d, want existing epoch 19", ProjectIndexSnapshotCacheEpoch)
	}

	doc := exportedConstDoc(t, "identity.go", "ProjectIndexSnapshotCacheEpoch")
	for _, phrase := range []string{
		"persisted `.crux/cache/index/index.json`",
		"stale snapshot masking after restart",
		"TS-owned AST and semantic fact cache identity",
	} {
		if !strings.Contains(doc, phrase) {
			t.Fatalf("ProjectIndexSnapshotCacheEpoch doc = %q, missing %q", doc, phrase)
		}
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
