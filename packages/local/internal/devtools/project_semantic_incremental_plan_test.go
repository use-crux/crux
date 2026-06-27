package devtools

import (
	"context"
	"errors"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"slices"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestReindexProjectIncrementalRunsPlannedSemanticDuringAstWork(t *testing.T) {
	root := t.TempDir()
	previous := plannedIncrementalPreviousIndex(root)
	indexer := &plannedIncrementalSemanticProjectIndexer{
		root:            root,
		semanticStarted: make(chan struct{}),
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()
	service.ApplyIndexPatch(context.Background(), indexPatchFromSnapshot(previous, projectindex.PhaseAST, "ok"))

	index, err := service.ReindexProjectIncremental(context.Background(), root, "", "project", []string{"src/writer.ts"}, nil)
	if err != nil {
		t.Fatalf("ReindexProjectIncremental error = %v", err)
	}
	if !indexer.astObservedSemanticStarted {
		t.Fatal("incremental AST completed before planned semantic work started")
	}
	if indexer.semanticSawPreviousIndex {
		t.Fatal("planned incremental semantic request received previous index, want explicit closure handoff")
	}
	definition := findDefinition(index.Definitions, "prompt:writer")
	if definition == nil || definition.Description != "semantic" {
		t.Fatalf("definitions = %+v, want planned semantic enrichment", index.Definitions)
	}
	assertStringSet(t, indexer.semanticReq.Files, []string{"src/writer.ts"})
	assertStringSet(t, indexer.semanticReq.DependencyClosure, []string{"src/helper.ts", "src/writer.ts"})
	helper := findSource(index.Sources, "src/helper.ts")
	if helper == nil || !slices.Contains(helper.Dependents, "src/writer.ts") {
		t.Fatalf("sources = %+v, want joined helper support source", index.Sources)
	}
}

func TestReindexProjectIncrementalDiscardsPlannedSemanticWhenScopeDiffers(t *testing.T) {
	root := t.TempDir()
	previous := plannedIncrementalPreviousIndex(root)
	indexer := &mismatchedPlannedIncrementalSemanticProjectIndexer{
		root:            root,
		semanticStarted: make(chan struct{}),
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()
	service.ApplyIndexPatch(context.Background(), indexPatchFromSnapshot(previous, projectindex.PhaseAST, "ok"))

	index, err := service.ReindexProjectIncremental(context.Background(), root, "", "project", []string{"src/writer.ts"}, nil)
	if err != nil {
		t.Fatalf("ReindexProjectIncremental error = %v", err)
	}
	if indexer.semanticCalls != 2 {
		t.Fatalf("semantic calls = %d, want early call plus post-AST fallback", indexer.semanticCalls)
	}
	definition := findDefinition(index.Definitions, "prompt:writer")
	if definition == nil || definition.Description != "fallback" {
		t.Fatalf("definitions = %+v, want post-AST fallback semantic result", index.Definitions)
	}
}

func plannedIncrementalPreviousIndex(root string) store.IndexData {
	return store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@use-crux/indexer",
			Capabilities: []string{
				"source-dependencies",
				"source-dependents",
				"definition-ownership",
				"diagnostic-ownership",
				"project-shards",
			},
			Shards: []store.ProjectIndexShard{{ID: ".", Root: "src"}},
		},
		Definitions: []store.ProjectDefinition{{
			ID:       "prompt:writer",
			Kind:     "prompt",
			Name:     "writer",
			Source:   &store.SourceLoc{File: "src/writer.ts"},
			Fidelity: "partial",
			Status:   "active",
		}},
		Sources: []store.IndexSourceFile{
			{
				File:          "src/writer.ts",
				Status:        "indexed",
				ShardID:       ".",
				DefinitionIDs: []string{"prompt:writer"},
				Dependencies:  []string{"src/helper.ts"},
			},
			{
				File:       "src/helper.ts",
				Status:     "indexed",
				ShardID:    ".",
				Dependents: []string{"src/writer.ts"},
			},
		},
	}
}

type plannedIncrementalSemanticProjectIndexer struct {
	root                       string
	semanticStarted            chan struct{}
	astObservedSemanticStarted bool
	semanticSawPreviousIndex   bool
	semanticReq                projectindex.ProjectSemanticIndexRequest
}

type mismatchedPlannedIncrementalSemanticProjectIndexer struct {
	root            string
	semanticStarted chan struct{}
	semanticCalls   int
}

func (i *mismatchedPlannedIncrementalSemanticProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, errors.New("full AST should not run for mismatched planned incremental semantic test")
}

func (i *mismatchedPlannedIncrementalSemanticProjectIndexer) IndexProjectIncremental(context.Context, string, string, string, store.IndexData, []string, []string, string) (projectindex.ProjectIndexIncrementalResult, error) {
	select {
	case <-i.semanticStarted:
	case <-time.After(time.Second):
		return projectindex.ProjectIndexIncrementalResult{}, errors.New("planned incremental semantic work did not start before AST finished")
	}
	return projectindex.ProjectIndexIncrementalResult{
		Report: projectindex.ProjectIndexIncrementalReport{
			PlanKind:        "source-file-reindex",
			GraphConfidence: "complete-enough-for-source-closure",
			ChangedFiles:    []string{"src/writer.ts"},
			AffectedFiles:   []string{"src/writer.ts"},
		},
		Patches: []projectindex.IndexPatch{{
			SchemaVersion: 1,
			Phase:         projectindex.PhaseAST,
			Project:       store.ProjectIdentity{Root: i.root, Name: "project"},
			Status:        "ok",
			Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{"src/writer.ts"}},
			Facts: projectindex.IndexPatchFacts{
				Definitions: []store.ProjectDefinition{{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer",
					Source:   &store.SourceLoc{File: "src/writer.ts"},
					Fidelity: "partial",
					Status:   "active",
				}},
				Sources: []store.IndexSourceFile{{
					File:          "src/writer.ts",
					Status:        "indexed",
					ShardID:       ".",
					DefinitionIDs: []string{"prompt:writer"},
				}},
			},
		}},
	}, nil
}

func (i *mismatchedPlannedIncrementalSemanticProjectIndexer) IndexProjectSemanticPatch(_ context.Context, req projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.semanticCalls++
	if i.semanticCalls == 1 {
		close(i.semanticStarted)
		return plannedIncrementalSemanticPatch(req, "early"), nil
	}
	return plannedIncrementalSemanticPatch(req, "fallback"), nil
}

func (i *plannedIncrementalSemanticProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, errors.New("full AST should not run for planned incremental semantic test")
}

func (i *plannedIncrementalSemanticProjectIndexer) IndexProjectIncremental(context.Context, string, string, string, store.IndexData, []string, []string, string) (projectindex.ProjectIndexIncrementalResult, error) {
	select {
	case <-i.semanticStarted:
		i.astObservedSemanticStarted = true
	case <-time.After(time.Second):
		return projectindex.ProjectIndexIncrementalResult{}, errors.New("planned incremental semantic work did not start before AST finished")
	}
	return projectindex.ProjectIndexIncrementalResult{
		Report: projectindex.ProjectIndexIncrementalReport{
			PlanKind:          "source-file-reindex",
			GraphConfidence:   "complete-enough-for-source-closure",
			ChangedFiles:      []string{"src/writer.ts"},
			AffectedFiles:     []string{"src/writer.ts"},
			StaticParsedFiles: []string{"src/writer.ts"},
		},
		Patches: []projectindex.IndexPatch{{
			SchemaVersion: 1,
			Phase:         projectindex.PhaseAST,
			Project:       store.ProjectIdentity{Root: i.root, Name: "project"},
			Status:        "ok",
			Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{"src/writer.ts"}},
			Facts: projectindex.IndexPatchFacts{
				Definitions: []store.ProjectDefinition{{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer",
					Source:   &store.SourceLoc{File: "src/writer.ts"},
					Fidelity: "partial",
					Status:   "active",
				}},
				Sources: []store.IndexSourceFile{{
					File:          "src/writer.ts",
					Status:        "indexed",
					ShardID:       ".",
					DefinitionIDs: []string{"prompt:writer"},
					Dependencies:  []string{"src/helper.ts"},
				}},
			},
			SemanticSourceProfile: &projectindex.SemanticSourceProfile{
				Complete: false,
				Files: []projectindex.SemanticSourceProfileFile{{
					File:        "src/writer.ts",
					SourceHash:  "writer",
					SourceBytes: 10,
					Hints:       &projectindex.SemanticSourceProfileHints{CruxCallNames: []string{"prompt"}},
				}},
				DependencyClosure: []string{"src/helper.ts", "src/writer.ts"},
				SourceBytes:       10,
			},
		}},
	}, nil
}

func (i *plannedIncrementalSemanticProjectIndexer) IndexProjectSemanticPatch(_ context.Context, req projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.semanticSawPreviousIndex = req.PreviousIndex != nil
	i.semanticReq = req
	close(i.semanticStarted)
	return plannedIncrementalSemanticPatch(req, "semantic"), nil
}

func plannedIncrementalSemanticPatch(req projectindex.ProjectSemanticIndexRequest, description string) projectindex.IndexPatch {
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: req.Root, Name: req.ProjectName, ConfigFile: req.ConfigPath},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:          "prompt:writer",
				Kind:        "prompt",
				Name:        "writer",
				Description: description,
				Fidelity:    "resolved",
				Status:      "active",
			}},
			SourceRefs: []projectindex.IndexSourceRefFact{{
				DefinitionID: "prompt:writer",
				Ref: store.ProjectSourceRef{
					ID:     "prompt:writer:source:schema",
					Role:   "schema",
					Source: store.SourceLoc{File: "src/helper.ts"},
					Symbol: "schema",
				},
			}},
		},
	}
}
