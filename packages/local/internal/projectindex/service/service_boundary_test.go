package service

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestServicePackageKeepsFacadeAndPipelineSplit(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	serviceDir := filepath.Dir(file)

	requiredFiles := []string{
		"service.go",             // facade only: Options/Service/New/With*/Has*/WatchStatus
		"pipeline.go",            // pipeline entry + reindex context
		"run.go",                 // refreshRun state shared by full/incremental flows
		"patch_apply.go",         // patch normalization + commit/apply/publish
		"reindex_full.go",        // full reindex flow
		"reindex_incremental.go", // incremental/watch reindex flow
		"runtime_reindex.go",     // runtime-rich reindex flow
		"semantic_scheduler.go",  // semantic phase task scheduling
		"lint_scheduler.go",      // lint phase scheduling + prefetch
		"watch.go",               // watch status store
	}
	for _, name := range requiredFiles {
		if _, err := os.Stat(filepath.Join(serviceDir, name)); err != nil {
			t.Fatalf("Project Index service layout is missing %s: %v", name, err)
		}
	}

	// The pre-Phase-5 file names must be gone; the no-backcompat policy forbids
	// leaving both the old and new layout in place.
	removedFiles := []string{
		"full_reindex.go",
		"incremental_reindex.go",
		"lint.go",
		"lint_prefetch.go",
		"semantic_task.go",
	}
	for _, name := range removedFiles {
		if _, err := os.Stat(filepath.Join(serviceDir, name)); err == nil {
			t.Fatalf("Project Index service layout still has retired file %s", name)
		}
	}
}

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

func TestServiceIncrementalSharesSemanticAndLintCompletion(t *testing.T) {
	indexer := &boundarySemanticIncrementalIndexer{}
	published := []store.IndexData{}
	service := New(Options{
		Store:   store.NewStore(),
		Indexer: indexer,
		Publish: func(index store.IndexData) {
			published = append(published, index)
		},
	})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(boundaryPreviousIndex(), projectindex.PhaseAST, "ok"))

	index, err := service.ReindexProjectIncrementalWithOptions(
		context.Background(),
		"/repo",
		"crux.config.ts",
		"project",
		[]string{"/repo/src/writer.ts"},
		nil,
		ProjectReindexOptions{Semantic: ProjectSemanticInline},
	)
	if err != nil {
		t.Fatalf("ReindexProjectIncrementalWithOptions error = %v", err)
	}

	// The incremental flow must run the same semantic + lint completion as the
	// full flow: semantic enrichment is applied, then lint observes it.
	if indexer.semanticCalls == 0 {
		t.Fatal("semantic phase did not run through the shared completion")
	}
	if indexer.lintCalls != 1 {
		t.Fatalf("lint calls = %d, want 1", indexer.lintCalls)
	}
	if !indexer.lintSawSemantic {
		t.Fatal("lint phase did not receive semantic-enriched index")
	}
	writer := findBoundaryDefinition(index.Definitions, "prompt:writer")
	if writer == nil || writer.Description != "semantic" {
		t.Fatalf("definitions = %+v, want semantic-enriched writer", index.Definitions)
	}
	if len(published) == 0 {
		t.Fatal("Publish was not called")
	}
}
