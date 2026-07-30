package cache

import (
	"context"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptTextDiagnosticEvidenceAndSourceRowSurviveRestart(t *testing.T) {
	t.Parallel()

	const (
		file         = "src/prompt.ts"
		diagnosticID = "prompt-text:invalid-interpolation:writer:0"
	)
	root := t.TempDir()
	ctx := context.Background()
	facts := NewSQLiteIndexFactStore()

	ast := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		FinishedAt:    "2026-07-27T10:00:00Z",
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Sources: []store.IndexSourceFile{{
				File:        file,
				Status:      "indexed",
				SourceHash:  "sha256:prompt",
				Diagnostics: []string{diagnosticID},
			}},
		},
	}
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(ast)); err != nil {
		t.Fatalf("commit AST source row: %v", err)
	}

	semantic := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseSemantic,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		FinishedAt:    "2026-07-27T10:00:01Z",
		Status:        "ok",
		Facts: IndexPatchFacts{
			Diagnostics: []store.IndexDiagnostic{{
				ID:       diagnosticID,
				Severity: "error",
				Code:     "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
				Message:  "PromptText interpolation 0 is always invalid.",
				Source:   &store.SourceLoc{File: file, Line: 2},
				Evidence: promptTextDiagnosticEvidence(0, []string{"boolean"}),
			}},
		},
	}
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(semantic)); err != nil {
		t.Fatalf("commit semantic diagnostic: %v", err)
	}

	reloaded, ok, err := NewSQLiteIndexFactStore().LoadSnapshot(
		ctx,
		root,
		"project",
		time.Date(2026, 7, 27, 10, 1, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("load snapshot after restart: %v", err)
	}
	if !ok {
		t.Fatal("load snapshot after restart returned no snapshot")
	}
	assertPromptTextDiagnosticEvidence(t, reloaded, diagnosticID, 0, []string{"boolean"})
	source := findTestSource(reloaded.Sources, file)
	if source == nil || source.SourceHash != "sha256:prompt" {
		t.Fatalf("reloaded source = %#v, want retained source hash", source)
	}

	semantic.FinishedAt = "2026-07-27T10:02:00Z"
	semantic.Facts.Diagnostics[0].Evidence = promptTextDiagnosticEvidence(
		1,
		[]string{"bigint", "symbol"},
	)
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(semantic)); err != nil {
		t.Fatalf("replace semantic diagnostic: %v", err)
	}
	replaced, ok, err := NewSQLiteIndexFactStore().ProjectSnapshot(ctx, root, "project")
	if err != nil || !ok {
		t.Fatalf("project replaced snapshot = (%#v, %v, %v)", replaced, ok, err)
	}
	assertPromptTextDiagnosticEvidence(
		t,
		replaced,
		diagnosticID,
		1,
		[]string{"bigint", "symbol"},
	)
}

func TestExplicitEmptyPromptTextDiagnosticsClearAcrossRestart(t *testing.T) {
	t.Parallel()

	const (
		file         = "src/prompt.ts"
		diagnosticID = "prompt-text:invalid-interpolation:writer:0"
	)
	root := t.TempDir()
	ctx := context.Background()
	facts := NewSQLiteIndexFactStore()
	ast := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Sources: []store.IndexSourceFile{{
				File:       file,
				Status:     "indexed",
				SourceHash: "sha256:prompt",
			}},
		},
	}
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(ast)); err != nil {
		t.Fatalf("commit AST source row: %v", err)
	}
	semantic := IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseSemantic,
		Project:       store.ProjectIdentity{Root: root, Name: "project"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Diagnostics: []store.IndexDiagnostic{{
				ID:       diagnosticID,
				Severity: "error",
				Code:     "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
				Message:  "invalid",
				Source:   &store.SourceLoc{File: file},
				Evidence: promptTextDiagnosticEvidence(0, []string{"boolean"}),
			}},
			Sources: []store.IndexSourceFile{{
				File:        file,
				Status:      "error",
				Diagnostics: []string{diagnosticID},
			}},
		},
	}
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(semantic)); err != nil {
		t.Fatalf("commit semantic diagnostic: %v", err)
	}

	semantic.Facts.Diagnostics = []store.IndexDiagnostic{}
	semantic.Facts.Sources = []store.IndexSourceFile{}
	if err := facts.CommitPhase(ctx, FactTransactionFromPatch(semantic)); err != nil {
		t.Fatalf("commit semantic clear: %v", err)
	}
	reloaded, ok, err := facts.ProjectSnapshot(ctx, root, "project")
	if err != nil || !ok {
		t.Fatalf("project cleared snapshot = (%#v, %v, %v)", reloaded, ok, err)
	}
	if len(reloaded.Diagnostics) != 0 {
		t.Fatalf("reloaded diagnostics = %#v, want empty", reloaded.Diagnostics)
	}
	source := findTestSource(reloaded.Sources, file)
	if source == nil || len(source.Diagnostics) != 0 {
		t.Fatalf("reloaded source = %#v, want no diagnostic ids", source)
	}
}

func promptTextDiagnosticEvidence(
	index int,
	runtimeKinds []string,
) *store.PromptTextDiagnosticEvidence {
	return &store.PromptTextDiagnosticEvidence{
		Kind:               "prompt-text",
		SourceRefID:        "prompt:writer:source:prompt",
		InterpolationIndex: index,
		Proof:              "semantic-exact",
		Cause: store.PromptTextDiagnosticCause{
			Kind:         "invalid-interpolation",
			RuntimeKinds: runtimeKinds,
		},
	}
}

func assertPromptTextDiagnosticEvidence(
	t *testing.T,
	index store.IndexData,
	diagnosticID string,
	interpolationIndex int,
	runtimeKinds []string,
) {
	t.Helper()
	diagnostic := findTestDiagnostic(index.Diagnostics, diagnosticID)
	if diagnostic == nil || diagnostic.Evidence == nil {
		t.Fatalf("diagnostics = %#v, want retained PromptText evidence", index.Diagnostics)
	}
	evidence := diagnostic.Evidence
	if evidence.Kind != "prompt-text" ||
		evidence.SourceRefID != "prompt:writer:source:prompt" ||
		evidence.InterpolationIndex != interpolationIndex ||
		evidence.Proof != "semantic-exact" ||
		evidence.Cause.Kind != "invalid-interpolation" {
		t.Fatalf("evidence = %#v, want exact PromptText evidence", evidence)
	}
	if len(evidence.Cause.RuntimeKinds) != len(runtimeKinds) {
		t.Fatalf("runtime kinds = %v, want %v", evidence.Cause.RuntimeKinds, runtimeKinds)
	}
	for index, want := range runtimeKinds {
		if evidence.Cause.RuntimeKinds[index] != want {
			t.Fatalf("runtime kinds = %v, want %v", evidence.Cause.RuntimeKinds, runtimeKinds)
		}
	}
}
