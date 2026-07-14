package service

import (
	"context"
	"errors"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestRegisterRuntimeSnapshotPreservesCompilerPhaseOwnership(t *testing.T) {
	t.Parallel()

	service := New(Options{Store: store.NewStore()})
	service.ApplyIndexPatch(context.Background(), projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "partial", Description: "AST"},
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		}},
	})
	service.RegisterRuntimeSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved", Description: "runtime"},
		},
	})
	index := service.ApplyIndexPatch(context.Background(), projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved", Description: "semantic"},
		}},
	})

	if got := definitionByID(t, index, "prompt:writer").Description; got != "semantic" {
		t.Fatalf("prompt description = %q, want semantic enrichment", got)
	}
	if !hasDefinition(index, "mcp.server:catalog") {
		t.Fatal("registered runtime snapshot was dropped by semantic enrichment")
	}
}

func TestFailedColdReindexDoesNotHydrateRuntimeProjectionAsCompilerState(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	indexer := &runtimeOverlayASTIndexer{root: root, failure: errors.New("synthetic AST failure")}
	service := New(Options{Store: store.NewStore(), Indexer: indexer})
	service.RegisterRuntimeSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:runtime", Kind: "prompt", Name: "runtime", Fidelity: "resolved"},
		},
	})

	if _, err := service.ReindexProject(context.Background(), root, "", "cold-failure"); err == nil {
		t.Fatal("failed cold reindex succeeded")
	}
	if hasDefinition(service.indexState.Index(), "prompt:runtime") {
		t.Fatal("runtime projection was hydrated into compiler state")
	}
	if !hasDefinition(service.store.GetIndex(), "prompt:runtime") {
		t.Fatal("failed reindex dropped the registered runtime snapshot")
	}
}

func TestRegisteredRuntimeSnapshotDoesNotMaskCompilerSourceOnlyState(t *testing.T) {
	t.Parallel()

	service := New(Options{Store: store.NewStore()})
	service.RegisterRuntimeSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	})
	index := service.ApplyIndexPatch(context.Background(), projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Diagnostics: []store.IndexDiagnostic{
				{ID: "diagnostic:index:source-only", Code: "index.source_only", Severity: "warning"},
			},
		},
	})

	if !projectindex.IsSourceOnlyIndex(index) {
		t.Fatalf("diagnostics = %+v, want compiler source-only state", index.Diagnostics)
	}
}
