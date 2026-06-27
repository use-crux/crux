package devtools

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"sync/atomic"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func BenchmarkReindexProjectIncrementalInlineOverlap(b *testing.B) {
	root := b.TempDir()
	changedFile := root + "/src/writer.ts"
	indexer := &incrementalOverlapBenchmarkIndexer{
		root:          root,
		changedFile:   changedFile,
		astDelay:      25 * time.Millisecond,
		semanticDelay: 50 * time.Millisecond,
		prefetchDelay: 25 * time.Millisecond,
	}
	service := NewService(store.NewStore(), nil).WithFactStore(nil).WithProjectIndexer(indexer)
	defer service.Shutdown()
	service.ApplyIndexPatch(context.Background(), indexPatchFromSnapshot(incrementalOverlapBenchmarkPreviousIndex(root, changedFile), projectindex.PhaseAST, "ok"))

	b.ReportAllocs()
	b.ResetTimer()
	for index := 0; index < b.N; index++ {
		if _, err := service.ReindexProjectIncremental(context.Background(), root, "crux.config.ts", "benchmark", []string{changedFile}, nil); err != nil {
			b.Fatalf("ReindexProjectIncremental error = %v", err)
		}
	}
	b.StopTimer()

	sequential := indexer.astDelay + indexer.semanticDelay + indexer.prefetchDelay
	overlapFloor := maxDuration(indexer.semanticDelay, indexer.astDelay+indexer.prefetchDelay)
	b.ReportMetric(float64(sequential.Milliseconds()), "modeled_sequential_ms/op")
	b.ReportMetric(float64(overlapFloor.Milliseconds()), "modeled_overlap_floor_ms/op")
	b.ReportMetric(float64(indexer.semanticCalls.Load())/float64(b.N), "semantic_calls/op")
	b.ReportMetric(float64(indexer.prefetchCalls.Load())/float64(b.N), "prefetch_calls/op")
}

type incrementalOverlapBenchmarkIndexer struct {
	root          string
	changedFile   string
	astDelay      time.Duration
	semanticDelay time.Duration
	prefetchDelay time.Duration
	semanticCalls atomic.Int64
	prefetchCalls atomic.Int64
}

func (i *incrementalOverlapBenchmarkIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *incrementalOverlapBenchmarkIndexer) IndexProjectIncremental(context.Context, string, string, string, store.IndexData, []string, []string, string) (projectindex.ProjectIndexIncrementalResult, error) {
	time.Sleep(i.astDelay)
	return projectindex.ProjectIndexIncrementalResult{
		Report: projectindex.ProjectIndexIncrementalReport{
			PlanKind:        "source-file-reindex",
			GraphConfidence: "complete-enough-for-source-closure",
			ChangedFiles:    []string{i.changedFile},
			AffectedFiles:   []string{i.changedFile},
		},
		Patches: []projectindex.IndexPatch{{
			SchemaVersion: 1,
			Phase:         projectindex.PhaseAST,
			Project:       store.ProjectIdentity{Root: i.root, Name: "benchmark", ConfigFile: "crux.config.ts"},
			Status:        "ok",
			Invalidates:   &projectindex.IndexPatchInvalidation{Files: []string{i.changedFile}},
			Facts: projectindex.IndexPatchFacts{
				Definitions: []store.ProjectDefinition{{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer",
					Source:   &store.SourceLoc{File: i.changedFile},
					Fidelity: "partial",
					Status:   "active",
				}},
				Sources: []store.IndexSourceFile{{
					File:          i.changedFile,
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

func (i *incrementalOverlapBenchmarkIndexer) IndexProjectSemanticPatch(ctx context.Context, req projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	i.semanticCalls.Add(1)
	if err := sleepBenchmarkPhase(ctx, i.semanticDelay); err != nil {
		return projectindex.IndexPatch{}, err
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseSemantic,
		Project:       store.ProjectIdentity{Root: req.Root, Name: req.ProjectName, ConfigFile: req.ConfigPath},
		Status:        "ok",
		Facts: projectindex.IndexPatchFacts{
			Definitions: []store.ProjectDefinition{{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
			}},
		},
	}, nil
}

func (i *incrementalOverlapBenchmarkIndexer) PrefetchProjectLintFacts(ctx context.Context, _ projectindex.ProjectLintIndexRequest) (projectindex.ProjectLintPrefetchResult, error) {
	i.prefetchCalls.Add(1)
	if err := sleepBenchmarkPhase(ctx, i.prefetchDelay); err != nil {
		return projectindex.ProjectLintPrefetchResult{}, err
	}
	return projectindex.ProjectLintPrefetchResult{}, nil
}

func (i *incrementalOverlapBenchmarkIndexer) IndexProjectLintPatch(context.Context, projectindex.ProjectLintIndexRequest) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func incrementalOverlapBenchmarkPreviousIndex(root string, changedFile string) store.IndexData {
	return store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "benchmark", ConfigFile: "crux.config.ts"},
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
			Shards: []store.ProjectIndexShard{{ID: ".", Root: root + "/src"}},
		},
		Definitions: []store.ProjectDefinition{{
			ID:       "prompt:writer",
			Kind:     "prompt",
			Name:     "writer",
			Source:   &store.SourceLoc{File: changedFile},
			Fidelity: "partial",
			Status:   "active",
		}},
		Sources: []store.IndexSourceFile{{
			File:          changedFile,
			Status:        "indexed",
			ShardID:       ".",
			DefinitionIDs: []string{"prompt:writer"},
			Dependencies:  []string{},
			Dependents:    []string{},
		}},
	}
}

func sleepBenchmarkPhase(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func maxDuration(left time.Duration, right time.Duration) time.Duration {
	if left > right {
		return left
	}
	return right
}
