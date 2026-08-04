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
	if ProjectIndexSnapshotCacheEpoch != 66 {
		t.Fatalf("ProjectIndexSnapshotCacheEpoch = %d, want Effect Runtime-addressability epoch 66", ProjectIndexSnapshotCacheEpoch)
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
		"Effect definitions",
		"Thread definitions",
		"runtime-observability identity",
		"context-planning structure",
		"Epoch 57",
		"distinct same-identity Effect call-site evidence",
		"first-class Thread lint findings",
		"Epoch 58",
		"sources deleted while offline",
		"Epoch 59",
		"Effect export metadata",
		"Epoch 60",
		"independently advanced Effect LSP and canonical Thread history",
		"Epoch 61",
		"evidence-backed irreversible Effect findings",
		"Connected Knowledge definitions",
		"Connected Knowledge lint findings",
		"Epoch 62",
		"Epoch 63",
		"independently advanced Effect boundary lint and Connected Knowledge",
		"Epoch 64",
		"direct Agent-tool relation",
		"dynamic nested PromptText identity",
		"Epoch 65",
		"neither independently assigned epoch 64 can mask the other",
		"Epoch 66",
		"recoverable Effect Runtime-addressability findings",
		"TS-owned AST and semantic fact cache identity",
	} {
		if !strings.Contains(normalizedDoc, phrase) {
			t.Fatalf("ProjectIndexSnapshotCacheEpoch doc = %q, missing %q", doc, phrase)
		}
	}
}

func TestProjectIndexFactStorePathIncludesSnapshotEpoch(t *testing.T) {
	root := t.TempDir()
	wantSuffix := filepath.Join(".crux", "cache", "index-v2", "epoch-66", "index.db")

	if got := projectIndexFactStoreDBFile(root); !strings.HasSuffix(got, wantSuffix) {
		t.Fatalf("projectIndexFactStoreDBFile() = %q, want suffix %q", got, wantSuffix)
	}
}

func TestProjectIndexFactStoreMissesPreExecutionEvidenceSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 54, "pre-execution-evidence snapshot")
}

func TestProjectIndexFactStoreMissesPreEffectDefinitionSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 55, "pre-Effect-definition snapshot")
}

func TestProjectIndexFactStoreMissesPreEffectCallSiteSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 56, "pre-Effect-call-site snapshot")
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

func TestProjectIndexFactStoreMissesPreMergedSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 57, "pre-merged Effects/context-planning snapshot")
}

func TestProjectIndexFactStoreMissesPreEffectCompletionSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 58, "pre-Effect-completion snapshot")
}

func TestProjectIndexFactStoreMissesPreConnectedKnowledgeSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 60, "pre-connected-knowledge snapshot")
}

func TestProjectIndexFactStoreMissesPreConnectedKnowledgeLintSnapshotEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 61, "pre-connected-knowledge-lint snapshot")
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

func TestProjectIndexFactStoreMissesPreDynamicNestedPromptTextEpoch(t *testing.T) {
	assertSnapshotEpochMiss(t, 64, "pre-dynamic-nested-prompt-text snapshot")
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
