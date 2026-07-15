package service

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/readmodel"
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
	if index.Indexing == nil || index.Indexing.Semantic.Backend != "native" {
		t.Fatalf("semantic indexing = %+v, want native backend provenance", index.Indexing)
	}
}

func TestDegradedSemanticPatchRemainsPartialInCatalog(t *testing.T) {
	service := New(Options{Store: store.NewStore()})
	service.ApplyIndexPatch(context.Background(), projectindex.IndexPatch{
		SchemaVersion: 1, Phase: projectindex.PhaseAST,
		Project: store.ProjectIdentity{Root: "/repo", Name: "project"}, Status: "ok",
		Facts: projectindex.IndexPatchFacts{Definitions: []store.ProjectDefinition{{
			ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "partial", Status: "active",
		}}},
	})
	patch := projectindex.IndexPatch{
		SchemaVersion: 1, Phase: projectindex.PhaseSemantic,
		Project:    store.ProjectIdentity{Root: "/repo", Name: "project"},
		FinishedAt: "2026-07-15T00:00:00Z", Status: "degraded", SemanticBackend: "typescript",
		Facts: projectindex.IndexPatchFacts{Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:semantic:z", Severity: "warning", Code: "index.semantic_failed", Message: "Later diagnostic."},
			{
				ID: "diagnostic:semantic:budget", Severity: "warning", Code: "index.semantic_budget_exceeded",
				Message: "Semantic input exceeded the configured budget.",
			},
		}},
	}
	index, applied, err := service.applyCompletedSemanticPatchIfCurrent(
		context.Background(), patch, service.indexState.CurrentGeneration(), time.Now(),
	)
	if err != nil || !applied {
		t.Fatalf("apply degraded semantic patch: applied=%v err=%v", applied, err)
	}
	encoded, err := json.Marshal(index)
	if err != nil {
		t.Fatal(err)
	}
	var catalogIndex api.IndexData
	if err := json.Unmarshal(encoded, &catalogIndex); err != nil {
		t.Fatal(err)
	}
	status := readmodel.CatalogStatus(catalogIndex, service.WatchStatus(), nil, nil)
	if status.Indexing == nil || status.Indexing.Status != "degraded" || status.Indexing.Semantic.Status != "degraded" {
		t.Fatalf("Catalog semantic status = %+v, want degraded", status.Indexing)
	}
	if status.Indexing.Semantic.Backend != "typescript" || status.Indexing.Error != "Semantic input exceeded the configured budget." {
		t.Fatalf("Catalog semantic evidence = %+v, want backend and stable error", status.Indexing)
	}
	explanation, found := readmodel.CatalogExplain(catalogIndex, "prompt:writer", nil, nil)
	if !found || explanation.Indexing.Backend != "typescript" || explanation.Indexing.PartialReason != status.Indexing.Error {
		t.Fatalf("Catalog explanation indexing = %+v, found=%v", explanation.Indexing, found)
	}
}

func TestPartialSemanticPatchMarksWatchRunDegraded(t *testing.T) {
	service := New(Options{Store: store.NewStore()})
	service.ApplyIndexPatch(context.Background(), projectindex.IndexPatch{
		SchemaVersion: 1, Phase: projectindex.PhaseAST,
		Project: store.ProjectIdentity{Root: "/repo", Name: "project"}, Status: "ok",
	})
	const runID = 45
	service.watchStatus.Start(ProjectWatchRunOptions{RunID: runID}, []string{"/repo/src/writer.ts"}, nil)

	_, err := service.applyProjectSemanticPatchResult(
		context.Background(),
		projectindex.ProjectSemanticIndexRequest{
			Root: "/repo", ProjectName: "project",
			IndexGeneration: service.indexState.CurrentGeneration(), WatchRunID: runID,
		},
		time.Now(),
		projectindex.IndexPatch{
			SchemaVersion: 1, Phase: projectindex.PhaseSemantic,
			Project: store.ProjectIdentity{Root: "/repo", Name: "project"},
			Status:  "partial", SemanticBackend: "typescript",
			Facts: projectindex.IndexPatchFacts{Diagnostics: []store.IndexDiagnostic{{
				ID: "diagnostic:semantic:partial", Severity: "warning",
				Code: "index.semantic_partial", Message: "Semantic indexing was partial.",
			}}},
		},
		nil,
		nil,
	)
	if err != nil {
		t.Fatalf("apply partial semantic patch: %v", err)
	}

	status := service.WatchStatus()
	if status.State != "degraded" || status.LastRun == nil ||
		status.LastRun.Status != "semantic-degraded" || status.LastRun.SemanticStatus != "degraded" {
		t.Fatalf("watch status = %+v, want degraded partial semantic run", status)
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
	if mode := service.SemanticMode(); mode != ProjectSemanticDisabled {
		t.Fatalf("semantic mode = %q, want disabled", mode)
	}
	if !status.LastRun.CoalescedWhileRunning || status.LastRun.PendingRunReplacedCount != 1 {
		t.Fatalf("watch queue telemetry = %+v, want coalesced replacement", status.LastRun)
	}
}

func TestServiceRecordsIncrementalFallbackReasonInWatchStatus(t *testing.T) {
	indexer := &watchFallbackIndexer{}
	service := New(Options{Store: store.NewStore(), Indexer: indexer})

	_, err := service.ReindexProjectIncrementalWithOptions(
		context.Background(),
		"/repo",
		"crux.config.ts",
		"project",
		[]string{"/repo/src/writer.ts"},
		nil,
		ProjectReindexOptions{
			Semantic: ProjectSemanticDisabled,
			Watch:    ProjectWatchRunOptions{RunID: 43},
		},
	)
	if err != nil {
		t.Fatalf("ReindexProjectIncrementalWithOptions error = %v", err)
	}

	if indexer.calledIncrement {
		t.Fatal("IndexProjectIncremental called without previous source graph")
	}
	if !indexer.calledFull {
		t.Fatal("IndexProjectAstPatch was not called for fallback")
	}
	status := service.WatchStatus()
	if status.LastRun == nil {
		t.Fatal("watch last run = nil")
	}
	if status.LastRun.RunID != 43 || !status.LastRun.FallbackUsed || status.LastRun.FallbackReason != "missing-previous-source-graph" {
		t.Fatalf("watch last run = %+v, want missing-previous-source-graph fallback", status.LastRun)
	}
}

func TestServiceReturnsWatchIncrementalBeforeBackgroundLint(t *testing.T) {
	indexer := &watchBackgroundLintIndexer{
		lintStarted: make(chan struct{}),
		releaseLint: make(chan struct{}),
		lintDone:    make(chan struct{}),
	}
	service := New(Options{Store: store.NewStore(), Indexer: indexer})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(boundaryPreviousIndex(), projectindex.PhaseAST, "ok"))

	done := make(chan error, 1)
	go func() {
		_, err := service.ReindexProjectIncrementalWithOptions(
			context.Background(),
			"/repo",
			"crux.config.ts",
			"project",
			[]string{"/repo/src/writer.ts"},
			nil,
			ProjectReindexOptions{
				Semantic: ProjectSemanticDisabled,
				Watch:    ProjectWatchRunOptions{RunID: 44},
			},
		)
		done <- err
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ReindexProjectIncrementalWithOptions error = %v", err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("watch incremental waited for lint")
	}
	select {
	case <-indexer.lintStarted:
	case <-time.After(time.Second):
		t.Fatal("background lint did not start")
	}
	close(indexer.releaseLint)
	select {
	case <-indexer.lintDone:
	case <-time.After(time.Second):
		t.Fatal("background lint did not finish")
	}
}

func TestServiceCancelsSupersededBackgroundSemantic(t *testing.T) {
	root := t.TempDir()
	indexer := newCancellableBackgroundSemanticIndexer(root)
	service := New(Options{Store: store.NewStore(), Indexer: indexer})
	service.WithFactStore(nil)
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(backgroundSemanticPreviousIndex(root), projectindex.PhaseAST, "ok"))

	_, err := service.ReindexProjectIncrementalWithOptions(
		context.Background(),
		root,
		"crux.config.ts",
		"project",
		[]string{filepath.Join(root, "src/a.ts")},
		nil,
		ProjectReindexOptions{Semantic: ProjectSemanticBackground, Watch: ProjectWatchRunOptions{RunID: 1}},
	)
	if err != nil {
		t.Fatalf("first ReindexProjectIncrementalWithOptions error = %v", err)
	}
	waitForClosed(t, indexer.firstStarted, "first semantic start")

	_, err = service.ReindexProjectIncrementalWithOptions(
		context.Background(),
		root,
		"crux.config.ts",
		"project",
		[]string{filepath.Join(root, "src/b.ts")},
		nil,
		ProjectReindexOptions{Semantic: ProjectSemanticBackground, Watch: ProjectWatchRunOptions{RunID: 2}},
	)
	if err != nil {
		t.Fatalf("second ReindexProjectIncrementalWithOptions error = %v", err)
	}
	waitForClosed(t, indexer.firstCanceled, "first semantic cancellation")
	waitForClosed(t, indexer.secondStarted, "second semantic start")
	close(indexer.releaseSecond)
	waitForClosed(t, indexer.secondDone, "second semantic completion")
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

func waitForClosed(t *testing.T, ch <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}
