package model_test

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestStateAppliesPatchThroughModelBoundary(t *testing.T) {
	state := model.NewState()

	index := state.Apply(model.IndexPatch{
		SchemaVersion: 1,
		Phase:         model.PhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "demo"},
		FinishedAt:    "2026-06-24T10:00:00Z",
		Status:        "ok",
		Facts: model.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer",
					Status:   "active",
					Fidelity: "partial",
					Source:   &store.SourceLoc{File: "src/writer.ts", Line: 1},
				},
			},
			Sources: []store.IndexSourceFile{
				{File: "src/writer.ts", Status: "active", DefinitionIDs: []string{"prompt:writer"}},
			},
		},
	})

	if index.Project == nil || index.Project.Root != "/repo" || index.Project.Name != "demo" {
		t.Fatalf("project = %+v, want /repo demo", index.Project)
	}
	if index.IndexedAt != "2026-06-24T10:00:00Z" {
		t.Fatalf("IndexedAt = %q, want patch finish time", index.IndexedAt)
	}
	if len(index.Definitions) != 1 || index.Definitions[0].ID != "prompt:writer" {
		t.Fatalf("definitions = %+v, want prompt:writer", index.Definitions)
	}
	if len(index.Sources) != 1 || index.Sources[0].File != "src/writer.ts" {
		t.Fatalf("sources = %+v, want src/writer.ts", index.Sources)
	}
}
