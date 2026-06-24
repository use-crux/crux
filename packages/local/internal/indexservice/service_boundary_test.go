package indexservice

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestServiceReindexesWithFakePhaseClients(t *testing.T) {
	indexer := &boundaryIndexer{}
	published := []store.IndexData{}
	service := New(Options{
		Store:   store.NewStore(),
		Indexer: indexer,
		Publish: func(index store.IndexData) {
			published = append(published, index)
		},
	})

	index, err := service.ReindexProject(context.Background(), "/repo", "crux.config.ts", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}

	if indexer.semanticCalls != 1 {
		t.Fatalf("semantic calls = %d, want 1", indexer.semanticCalls)
	}
	if indexer.lintCalls != 1 {
		t.Fatalf("lint calls = %d, want 1", indexer.lintCalls)
	}
	if !indexer.lintSawSemantic {
		t.Fatal("lint phase did not receive semantic-enriched index")
	}
	if len(published) == 0 {
		t.Fatal("Publish was not called")
	}
	if findBoundaryDefinition(index.Definitions, "prompt:writer") == nil {
		t.Fatalf("definitions = %+v, want semantic definition", index.Definitions)
	}
}

func TestServiceRecordsIncrementalWatchStatusWithFakeClient(t *testing.T) {
	indexer := &boundaryIncrementalIndexer{}
	service := New(Options{Store: store.NewStore(), Indexer: indexer})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(boundaryPreviousIndex(), projectindex.PhaseAST, "ok"))

	_, err := service.ReindexProjectIncrementalWithOptions(
		context.Background(),
		"/repo",
		"crux.config.ts",
		"project",
		[]string{"/repo/src/writer.ts"},
		nil,
		ProjectReindexOptions{
			Semantic: ProjectSemanticDisabled,
			Watch: ProjectWatchRunOptions{
				RunID:                   42,
				DeltaBatchCount:         2,
				CoalescedWhileRunning:   true,
				PendingRunReplacedCount: 1,
			},
		},
	)
	if err != nil {
		t.Fatalf("ReindexProjectIncrementalWithOptions error = %v", err)
	}

	status := service.WatchStatus()
	if status.State != "idle" {
		t.Fatalf("watch state = %q, want idle after disabled semantic", status.State)
	}
	if status.LastRun == nil {
		t.Fatal("watch last run = nil")
	}
	if status.LastRun.RunID != 42 || status.LastRun.Status != "semantic-disabled" {
		t.Fatalf("watch last run = %+v, want semantic-disabled run 42", status.LastRun)
	}
	if status.LastRun.PlanKind != "source-file-reindex" || status.LastRun.PatchCount != 1 {
		t.Fatalf("watch last run = %+v, want incremental patch result", status.LastRun)
	}
	if !status.LastRun.CoalescedWhileRunning || status.LastRun.PendingRunReplacedCount != 1 {
		t.Fatalf("watch queue telemetry = %+v, want coalesced replacement", status.LastRun)
	}
}

type boundaryIndexer struct {
	semanticCalls   int
	lintCalls       int
	lintSawSemantic bool
}

func (i *boundaryIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "partial",
				Status:   "active",
			}},
		},
	}, nil
}

func (i *boundaryIndexer) IndexProjectSemanticPatch(context.Context, projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.semanticCalls++
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:          "prompt:writer",
				Kind:        "prompt",
				Name:        "writer",
				Description: "semantic",
				Fidelity:    "resolved",
				Status:      "active",
			}},
		},
	}, nil
}

func (i *boundaryIndexer) IndexProjectLintPatch(_ context.Context, request projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	i.lintCalls++
	i.lintSawSemantic = findBoundaryDefinition(request.PreviousIndex.Definitions, "prompt:writer") != nil
	return projectindex.IndexPatch{}, nil
}

func findBoundaryDefinition(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for index := range definitions {
		if definitions[index].ID == id {
			return &definitions[index]
		}
	}
	return nil
}

type boundaryIncrementalIndexer struct{}

func (i *boundaryIncrementalIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *boundaryIncrementalIndexer) IndexProjectIncremental(
	context.Context,
	string,
	string,
	string,
	store.IndexData,
	[]string,
	[]string,
	string,
) (projectindex.ProjectIndexIncrementalResult, error) {
	return projectindex.ProjectIndexIncrementalResult{
		Report: projectindex.ProjectIndexIncrementalReport{
			PlanKind:        "source-file-reindex",
			GraphConfidence: "complete-enough-for-source-closure",
			ChangedFiles:    []string{"/repo/src/writer.ts"},
			AffectedFiles:   []string{"/repo/src/writer.ts"},
			DurationMsByPhase: map[string]float64{
				"ast.incremental": 4,
			},
		},
		Patches: []projectindex.IndexPatch{{
			SchemaVersion: 1,
			Phase:         projectindex.PhaseAST,
			Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
			Status:        "ok",
			Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{"/repo/src/writer.ts"}},
			Facts: projectindex.IndexPatchFacts{
				Definitions: []store.ProjectDefinition{{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer",
					Source:   &store.SourceLoc{File: "/repo/src/writer.ts"},
					Fidelity: "partial",
					Status:   "active",
				}},
				Sources: []store.IndexSourceFile{{
					File:          "/repo/src/writer.ts",
					Status:        "indexed",
					ShardID:       ".",
					DefinitionIDs: []string{"prompt:writer"},
				}},
			},
		}},
	}, nil
}

func boundaryPreviousIndex() store.IndexData {
	return store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		SourceGraph: &store.ProjectIndexSourceGraph{
			SchemaVersion: 1,
			ProducedBy:    "@crux/indexer",
			Capabilities: []string{
				"source-dependencies",
				"source-dependents",
				"definition-ownership",
				"diagnostic-ownership",
				"project-shards",
			},
			Shards: []store.ProjectIndexShard{{ID: ".", Root: "/repo/src"}},
		},
		Definitions: []store.ProjectDefinition{{
			ID:       "prompt:writer",
			Kind:     "prompt",
			Name:     "writer",
			Source:   &store.SourceLoc{File: "/repo/src/writer.ts"},
			Fidelity: "partial",
			Status:   "active",
		}},
		Sources: []store.IndexSourceFile{{
			File:          "/repo/src/writer.ts",
			Status:        "indexed",
			ShardID:       ".",
			DefinitionIDs: []string{"prompt:writer"},
			Dependencies:  []string{},
			Dependents:    []string{},
		}},
	}
}
