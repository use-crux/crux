package devtools

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestReindexProjectIncrementalInlinePrefetchesLintFactsWhileSemanticRuns(t *testing.T) {
	indexer := &incrementalConcurrentLintProjectIndexer{
		semanticStarted: make(chan struct{}),
		releaseSemantic: make(chan struct{}),
		prefetchStarted: make(chan struct{}),
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()
	service.ApplyIndexPatch(context.Background(), indexPatchFromSnapshot(incrementalLintPreviousIndex(), indexPatchPhaseAST, "ok"))

	done := make(chan error, 1)
	go func() {
		_, err := service.ReindexProjectIncremental(context.Background(), "/repo", "crux.config.ts", "project", []string{"/repo/src/writer.ts"}, nil)
		done <- err
	}()

	waitClosed(t, indexer.semanticStarted, "incremental semantic worker did not start")
	waitClosed(t, indexer.prefetchStarted, "incremental lint prefetch did not start while semantic was blocked")
	close(indexer.releaseSemantic)

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ReindexProjectIncremental error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("ReindexProjectIncremental did not finish")
	}
	if !indexer.sawSemanticQuality {
		t.Fatal("incremental lint request did not include semantic quality data")
	}
	if !indexer.sawPrefetchedRuleFacts {
		t.Fatal("incremental lint request did not include prefetched rule facts")
	}
}

type incrementalConcurrentLintProjectIndexer struct {
	semanticStarted        chan struct{}
	releaseSemantic        chan struct{}
	prefetchStarted        chan struct{}
	sawSemanticQuality     bool
	sawPrefetchedRuleFacts bool
}

func incrementalLintPreviousIndex() store.IndexData {
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

func (i *incrementalConcurrentLintProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (IndexPatch, error) {
	return IndexPatch{}, nil
}

func (i *incrementalConcurrentLintProjectIndexer) IndexProjectIncremental(context.Context, string, string, string, store.IndexData, []string, []string, string) (ProjectIndexIncrementalResult, error) {
	return ProjectIndexIncrementalResult{
		Report: ProjectIndexIncrementalReport{
			PlanKind:        "source-file-reindex",
			GraphConfidence: "complete-enough-for-source-closure",
			ChangedFiles:    []string{"/repo/src/writer.ts"},
			AffectedFiles:   []string{"/repo/src/writer.ts"},
		},
		Patches: []IndexPatch{{
			SchemaVersion: 1,
			Phase:         indexPatchPhaseAST,
			Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
			Status:        "ok",
			Invalidates:   &IndexPatchInvalidation{Files: []string{"/repo/src/writer.ts"}},
			Facts: IndexPatchFacts{
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
			},
		}},
	}, nil
}

func (i *incrementalConcurrentLintProjectIndexer) IndexProjectSemanticPatch(ctx context.Context, _ ProjectSemanticIndexRequest) (IndexPatch, error) {
	close(i.semanticStarted)
	select {
	case <-i.releaseSemantic:
	case <-ctx.Done():
		return IndexPatch{}, ctx.Err()
	}
	return IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
				Quality: &store.IndexQuality{
					ExperimentIDs:   []string{"experiment:writer"},
					ExperimentCount: 1,
				},
			}},
		},
	}, nil
}

func (i *incrementalConcurrentLintProjectIndexer) PrefetchProjectLintFacts(context.Context, ProjectLintIndexRequest) (ProjectLintPrefetchResult, error) {
	close(i.prefetchStarted)
	return ProjectLintPrefetchResult{
		RuleFacts: []json.RawMessage{json.RawMessage(`{"ruleResults":[{"ruleId":"extension.rule"}]}`)},
	}, nil
}

func (i *incrementalConcurrentLintProjectIndexer) IndexProjectLintPatch(_ context.Context, req ProjectLintIndexRequest) (IndexPatch, error) {
	for _, definition := range req.PreviousIndex.Definitions {
		if definition.ID == "prompt:writer" && definition.Quality != nil {
			i.sawSemanticQuality = true
		}
	}
	i.sawPrefetchedRuleFacts = req.Prefetch != nil && len(req.Prefetch.RuleFacts) == 1
	return IndexPatch{}, nil
}
