package cache

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestProjectIndexSnapshotCacheEpochOwnsGoSnapshotContract(t *testing.T) {
	if ProjectIndexSnapshotCacheEpoch != 60 {
		t.Fatalf("ProjectIndexSnapshotCacheEpoch = %d, want Connected Knowledge epoch 60", ProjectIndexSnapshotCacheEpoch)
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
		"Epoch 48",
		"runtime-rich Eval timeout policy facts",
		"Epoch 49",
		"provider-visible tool Safety boundary metadata",
		"Epoch 50",
		"privacy-safe effective observability policy",
		"Epoch 51",
		"bounded media stream operation facts",
		"Epoch 52",
		"fragment-join evidence",
		"Epoch 53",
		"PromptText diagnostic evidence",
		"Epoch 54",
		"PromptText refactor source-ref metadata",
		"compiler-owned source classification",
		"Epoch 55",
		"authored evidence.record definitions",
		"Epoch 56",
		"authored Thread definitions",
		"context-planning structure",
		"Epoch 57",
		"first-class Thread lint findings",
		"Epoch 58",
		"sources deleted while offline",
		"Epoch 59",
		"independently advanced Thread and context-planning",
		"Epoch 60",
		"Connected Knowledge definitions",
		"TS-owned AST and semantic fact cache identity",
	} {
		if !strings.Contains(normalizedDoc, phrase) {
			t.Fatalf("ProjectIndexSnapshotCacheEpoch doc = %q, missing %q", doc, phrase)
		}
	}
}

func TestProjectIndexFactStorePathIncludesSnapshotEpoch(t *testing.T) {
	root := t.TempDir()
	wantSuffix := filepath.Join(".crux", "cache", "index-v2", "epoch-60", "index.db")

	if got := projectIndexFactStoreDBFile(root); !strings.HasSuffix(got, wantSuffix) {
		t.Fatalf("projectIndexFactStoreDBFile() = %q, want suffix %q", got, wantSuffix)
	}
}

func TestProjectIndexFactStoreMissesPreExecutionEvidenceSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 54, "pre-execution-evidence snapshot")
}

func TestProjectIndexFactStoreMissesPreThreadLintSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 56, "pre-Thread-lint snapshot")
}

func TestProjectIndexFactStoreMissesPreStaleDeletionSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 57, "pre-stale-deletion snapshot")
}

func TestProjectIndexFactStoreMissesPreContextPlanningSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 55, "pre-context-planning snapshot")
}

func TestProjectIndexFactStoreMissesPreConnectedKnowledgeSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 59, "pre-connected-knowledge snapshot")
}

func TestProjectIndexFactStoreMissesPreBoundedMediaStreamSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 50, "pre-bounded-media-stream snapshot")
}

func TestProjectIndexFactStoreMissesPreObservabilityPolicySnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 49, "pre-observability-policy snapshot")
}

func TestProjectIndexFactStoreMissesPreEvalTimeoutSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 47, "pre-Eval-timeout snapshot")
}

func TestProjectIndexFactStoreMissesPrePromptTextSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 46, "pre-prompt-text snapshot")
}

func TestProjectIndexFactStoreMissesPreFragmentJoinSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 51, "pre-fragment-join snapshot")
}

func TestProjectIndexFactStoreMissesPrePromptTextDiagnosticEvidenceEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 52, "pre-prompt-text-diagnostic-evidence snapshot")
}

func TestProjectIndexFactStoreMissesPrePromptTextRefactorEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 53, "pre-prompt-text-refactor snapshot")
}

func assertSnapshotEpochMiss(t *testing.T, epoch int, contents string) {
	t.Helper()

	root := t.TempDir()
	oldPath := filepath.Join(
		root,
		".crux",
		"cache",
		"index-v2",
		"epoch-"+strconv.Itoa(epoch),
		"index.db",
	)
	if err := os.MkdirAll(filepath.Dir(oldPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldPath, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}

	currentPath := projectIndexFactStoreDBFile(root)
	if currentPath == oldPath {
		t.Fatalf("current snapshot path reused epoch-%d snapshot %q", epoch, currentPath)
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
