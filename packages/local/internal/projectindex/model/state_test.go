package model

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestStateAppliesASTPatchAndTracksGeneration(t *testing.T) {
	state := NewState()
	if got := state.CurrentGeneration(); got != 0 {
		t.Fatalf("initial generation = %d, want 0", got)
	}

	index := state.Apply(IndexPatch{
		SchemaVersion: 1,
		Phase:         PhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer"}},
		},
	})

	if got := state.CurrentGeneration(); got != 1 {
		t.Fatalf("generation = %d, want 1", got)
	}
	if !state.IsCurrent(1) {
		t.Fatal("generation 1 should be current")
	}
	if state.IsCurrent(2) {
		t.Fatal("generation 2 should not be current")
	}
	if len(index.Definitions) != 1 || index.Definitions[0].ID != "prompt:writer" {
		t.Fatalf("definitions = %+v, want prompt:writer", index.Definitions)
	}
}

func TestStateHydrateDoesNotAdvanceGeneration(t *testing.T) {
	state := NewState()
	state.Hydrate(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: "/repo", Name: "project"},
		Definitions:   []store.ProjectDefinition{{ID: "context:brand", Kind: "context", Name: "brand"}},
	}, PhaseCache, "ok")

	if got := state.CurrentGeneration(); got != 0 {
		t.Fatalf("generation = %d, want 0", got)
	}
	index := state.Index()
	if len(index.Definitions) != 1 || index.Definitions[0].ID != "context:brand" {
		t.Fatalf("definitions = %+v, want context:brand", index.Definitions)
	}
}

func TestStateCopiesPhaseDiagnostics(t *testing.T) {
	state := NewState()
	diagnostics := []store.IndexDiagnostic{{ID: "diagnostic:ast"}}
	state.SetPhaseDiagnostics(PhaseAST, diagnostics)
	diagnostics[0].ID = "mutated"

	copied := state.PhaseDiagnostics(PhaseAST)
	if len(copied) != 1 || copied[0].ID != "diagnostic:ast" {
		t.Fatalf("diagnostics = %+v, want immutable phase copy", copied)
	}
	copied[0].ID = "mutated-again"
	again := state.PhaseDiagnostics(PhaseAST)
	if len(again) != 1 || again[0].ID != "diagnostic:ast" {
		t.Fatalf("diagnostics = %+v, want immutable returned copy", again)
	}
}
