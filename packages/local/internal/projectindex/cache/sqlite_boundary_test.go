package cache_test

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestSQLiteStoreCommitsModelPatchAndProjectsSnapshot(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	facts := cache.NewSQLiteIndexFactStore()

	patch := model.IndexPatch{
		SchemaVersion: 1,
		Phase:         model.PhaseAST,
		Project:       store.ProjectIdentity{Root: root, Name: "demo"},
		FinishedAt:    "2026-06-24T10:00:00Z",
		Status:        "ok",
		Invalidates:   &model.IndexPatchInvalidation{All: true},
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
	}

	if err := facts.CommitPhase(ctx, model.FactTransactionFromPatch(patch)); err != nil {
		t.Fatalf("CommitPhase error = %v", err)
	}
	projected, ok, err := facts.ProjectSnapshot(ctx, root, "demo")
	if err != nil {
		t.Fatalf("ProjectSnapshot error = %v", err)
	}
	if !ok {
		t.Fatal("ProjectSnapshot ok = false, want stored snapshot")
	}
	if len(projected.Definitions) != 1 || projected.Definitions[0].ID != "prompt:writer" {
		t.Fatalf("definitions = %+v, want prompt:writer", projected.Definitions)
	}
}
