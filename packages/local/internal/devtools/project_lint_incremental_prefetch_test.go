package devtools

import (
	"context"
	"encoding/json"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
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
	service.ApplyIndexPatch(context.Background(), indexPatchFromSnapshot(incrementalLintPreviousIndex(), projectindex.PhaseAST, "ok"))

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
	if !indexer.sawSemanticRuns {
		t.Fatal("incremental lint request did not include semantic quality data")
	}
	if !indexer.sawPrefetchedRuleFacts {
		t.Fatal("incremental lint request did not include prefetched rule facts")
	}
	if !indexer.sawPrefetchStaticIndex {
		t.Fatal("incremental lint prefetch did not receive ASTUsedStaticIndex")
	}
	if !indexer.sawLintStaticIndex {
		t.Fatal("incremental lint request did not receive ASTUsedStaticIndex")
	}
}

type incrementalConcurrentLintProjectIndexer struct {
	semanticStarted        chan struct{}
	releaseSemantic        chan struct{}
	prefetchStarted        chan struct{}
	sawSemanticRuns        bool
	sawPrefetchedRuleFacts bool
	sawPrefetchStaticIndex bool
	sawLintStaticIndex     bool
}

func incrementalLintPreviousIndex() store.IndexData {
	return store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
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

func (i *incrementalConcurrentLintProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *incrementalConcurrentLintProjectIndexer) IndexProjectIncremental(context.Context, string, string, string, store.IndexData, []string, []string, string) (projectindex.ProjectIndexIncrementalResult, error) {
	return projectindex.ProjectIndexIncrementalResult{
		Report: projectindex.ProjectIndexIncrementalReport{
			PlanKind:           "source-file-reindex",
			ASTUsedStaticIndex: true,
			GraphConfidence:    "complete-enough-for-source-closure",
			ChangedFiles:       []string{"/repo/src/writer.ts"},
			AffectedFiles:      []string{"/repo/src/writer.ts"},
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
					Dependencies:  []string{},
					Dependents:    []string{},
				}},
			},
		}},
	}, nil
}

func (i *incrementalConcurrentLintProjectIndexer) IndexProjectSemanticPatch(ctx context.Context, _ projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	close(i.semanticStarted)
	select {
	case <-i.releaseSemantic:
	case <-ctx.Done():
		return projectindex.IndexPatch{}, ctx.Err()
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "crux.config.ts"},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
				Quality: &store.IndexQuality{
					RunIDs:   []string{"experiment:writer"},
					RunCount: 1,
				},
			}},
		},
	}, nil
}

func (i *incrementalConcurrentLintProjectIndexer) PrefetchProjectLintFacts(_ context.Context, req projectindex.ProjectLintIndexRequest) (projectindex.ProjectLintPrefetchResult, error) {
	close(i.prefetchStarted)
	i.sawPrefetchStaticIndex = req.ASTUsedStaticIndex
	return projectindex.ProjectLintPrefetchResult{
		RuleFacts: []json.RawMessage{json.RawMessage(`{"ruleResults":[{"ruleId":"extension.rule"}]}`)},
	}, nil
}

func (i *incrementalConcurrentLintProjectIndexer) IndexProjectLintPatch(_ context.Context, req projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	for _, definition := range req.PreviousIndex.Definitions {
		if definition.ID == "prompt:writer" && definition.Quality != nil {
			i.sawSemanticRuns = true
		}
	}
	i.sawPrefetchedRuleFacts = req.Prefetch != nil && len(req.Prefetch.RuleFacts) == 1
	i.sawLintStaticIndex = req.ASTUsedStaticIndex
	return projectindex.IndexPatch{}, nil
}
