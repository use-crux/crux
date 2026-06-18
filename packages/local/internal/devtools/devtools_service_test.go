package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type recordingProjectIndexer struct {
	deadline    time.Time
	hasDeadline bool
	staticOnly  bool
}

type failingProjectIndexer struct{}

func (failingProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (IndexPatch, error) {
	return IndexPatch{}, errors.New("index worker failed")
}

type staticIndexProjectIndexer struct {
	index store.IndexData
}

func (i staticIndexProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (IndexPatch, error) {
	return indexPatchFromSnapshot(i.index, indexPatchPhaseAST, "ok"), nil
}

type blockingProjectIndexer struct {
	index   store.IndexData
	started chan struct{}
	release chan struct{}
}

type semanticPatchProjectIndexer struct {
	index          store.IndexData
	semanticPatch  IndexPatch
	semanticErr    error
	calledSemantic bool
}

type blockingSemanticProjectIndexer struct {
	index          store.IndexData
	calledSemantic bool
}

type incrementalProjectIndexer struct {
	index           store.IndexData
	result          ProjectIndexIncrementalResult
	previous        store.IndexData
	files           []string
	deletedFiles    []string
	mode            string
	calledFull      bool
	calledIncrement bool
}

func (i *incrementalProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (IndexPatch, error) {
	i.calledFull = true
	return indexPatchFromSnapshot(i.index, indexPatchPhaseAST, "ok"), nil
}

func (i *incrementalProjectIndexer) IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (ProjectIndexIncrementalResult, error) {
	i.calledIncrement = true
	i.previous = previousIndex
	i.files = append([]string(nil), files...)
	i.deletedFiles = append([]string(nil), deletedFiles...)
	i.mode = mode
	return i.result, nil
}

func (i *blockingSemanticProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (IndexPatch, error) {
	return indexPatchFromSnapshot(i.index, indexPatchPhaseAST, "ok"), nil
}

func (i *blockingSemanticProjectIndexer) IndexProjectSemanticPatch(ctx context.Context, root, configPath, projectName string, budget IndexPatchBudget) (IndexPatch, error) {
	i.calledSemantic = true
	<-ctx.Done()
	return IndexPatch{}, ctx.Err()
}

func (i *semanticPatchProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (IndexPatch, error) {
	return indexPatchFromSnapshot(i.index, indexPatchPhaseAST, "ok"), nil
}

func (i *semanticPatchProjectIndexer) IndexProjectSemanticPatch(context.Context, string, string, string, IndexPatchBudget) (IndexPatch, error) {
	i.calledSemantic = true
	if i.semanticErr != nil {
		return IndexPatch{}, i.semanticErr
	}
	return i.semanticPatch, nil
}

func newBlockingProjectIndexer(index store.IndexData) *blockingProjectIndexer {
	return &blockingProjectIndexer{
		index:   index,
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (i *blockingProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string, staticOnly bool) (IndexPatch, error) {
	select {
	case <-i.started:
	default:
		close(i.started)
	}
	select {
	case <-ctx.Done():
		return IndexPatch{}, ctx.Err()
	case <-i.release:
		if i.index.Project == nil {
			i.index.Project = &store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
		}
		return indexPatchFromSnapshot(i.index, indexPatchPhaseAST, "ok"), nil
	}
}

func (r *recordingProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string, staticOnly bool) (IndexPatch, error) {
	r.deadline, r.hasDeadline = ctx.Deadline()
	r.staticOnly = staticOnly
	return indexPatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: projectName},
		IndexedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		Definitions:   []store.ProjectDefinition{},
		Relations:     []store.ProjectRelation{},
		Diagnostics:   []store.IndexDiagnostic{},
		Sources:       []store.IndexSourceFile{},
	}, indexPatchPhaseAST, "ok"), nil
}

func TestServiceReindexProjectDefaultDeadlineAllowsAstDiscovery(t *testing.T) {
	root := t.TempDir()
	indexer := &recordingProjectIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	start := time.Now()
	if _, err := service.ReindexProject(context.Background(), root, "", "project"); err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if !indexer.hasDeadline {
		t.Fatal("IndexProjectAstPatch context had no deadline")
	}
	if !indexer.staticOnly {
		t.Fatal("IndexProjectAstPatch staticOnly = false, want source-only AST indexing by default")
	}
	remaining := time.Until(indexer.deadline)
	if remaining < 55*time.Second || remaining > defaultProjectIndexReindexTimeout {
		t.Fatalf("IndexProject deadline remaining = %s, want about %s", remaining, defaultProjectIndexReindexTimeout)
	}
	if indexer.deadline.Before(start.Add(55 * time.Second)) {
		t.Fatalf("IndexProject deadline = %s, want at least 55s from start", indexer.deadline)
	}
}

func TestReindexProjectPublishesIndexingStatus(t *testing.T) {
	root := t.TempDir()
	indexer := &recordingProjectIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if index.Indexing == nil {
		t.Fatal("index.Indexing = nil, want backend-owned indexing status")
	}
	if index.Indexing.Status != "ready" {
		t.Fatalf("index.Indexing.Status = %q, want ready", index.Indexing.Status)
	}
	if index.Indexing.AST.Status != "ready" {
		t.Fatalf("index.Indexing.AST.Status = %q, want ready", index.Indexing.AST.Status)
	}
	if index.Indexing.Semantic.Status != "disabled" {
		t.Fatalf("index.Indexing.Semantic.Status = %q, want disabled", index.Indexing.Semantic.Status)
	}
	if index.Indexing.AST.IndexedAt == "" {
		t.Fatal("index.Indexing.AST.IndexedAt empty, want source index timestamp")
	}
}

func TestReindexProjectPublishesCachedIndexBeforeSlowRefresh(t *testing.T) {
	root := t.TempDir()
	writeTestIndexCache(t, root, store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		IndexedAt:     "2026-06-01T10:00:00.000Z",
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:cached", Kind: "prompt", Name: "cached", Fidelity: "resolved", Status: "active"},
		},
	})
	indexer := newBlockingProjectIndexer(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
		},
	})
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.IndexEvents().Subscribe(ctx)
	done := make(chan error, 1)
	go func() {
		_, err := service.ReindexProject(ctx, root, "", "project")
		done <- err
	}()
	<-indexer.started

	cached := readIndexEvent(t, events)
	if findDefinition(cached.Definitions, "prompt:cached") == nil {
		t.Fatalf("definitions = %+v, want cached definition before refresh finishes", cached.Definitions)
	}
	if cached.Indexing == nil || cached.Indexing.Status != "cached" {
		t.Fatalf("indexing = %+v, want cached status", cached.Indexing)
	}
	if cached.Indexing.Cache == nil || cached.Indexing.Cache.Status != "stale" {
		t.Fatalf("cache = %+v, want stale cache status", cached.Indexing.Cache)
	}

	close(indexer.release)
	if err := <-done; err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	final := readIndexEvent(t, events)
	if findDefinition(final.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want fresh definition after refresh", final.Definitions)
	}
	if findDefinition(final.Definitions, "prompt:cached") != nil {
		t.Fatalf("definitions = %+v, want fresh AST refresh to replace stale cache", final.Definitions)
	}
}

func TestReindexProjectWritesIndexCacheBestEffort(t *testing.T) {
	root := t.TempDir()
	service := NewService(store.NewStore(), nil).WithProjectIndexer(staticIndexProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
			},
		},
	})
	defer service.Shutdown()

	if _, err := service.ReindexProject(context.Background(), root, "", "project"); err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}

	index, ok := readTestIndexCache(t, root)
	if !ok {
		t.Fatal("index cache missing after successful reindex")
	}
	if findDefinition(index.Definitions, "prompt:fresh") == nil {
		t.Fatalf("cache definitions = %+v, want fresh definition", index.Definitions)
	}
	if index.Indexing == nil || index.Indexing.Status != "ready" {
		t.Fatalf("cache indexing = %+v, want final ready snapshot", index.Indexing)
	}
}

func TestReindexProjectIncrementalAppliesWorkerPatches(t *testing.T) {
	root := t.TempDir()
	previous := store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:old", Kind: "prompt", Name: "old", Fidelity: "resolved", Status: "active", Source: &store.SourceLoc{File: "src/a.ts", Line: 1}},
			{ID: "prompt:kept", Kind: "prompt", Name: "kept", Fidelity: "resolved", Status: "active", Source: &store.SourceLoc{File: "src/b.ts", Line: 1}},
		},
		Sources: []store.IndexSourceFile{
			{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"prompt:old"}},
			{File: "src/b.ts", Status: "active", DefinitionIDs: []string{"prompt:kept"}},
		},
	}
	indexer := &incrementalProjectIndexer{
		result: ProjectIndexIncrementalResult{
			Report: ProjectIndexIncrementalReport{PlanKind: "source-file-reindex", ChangedFiles: []string{"src/a.ts"}},
			Patches: []IndexPatch{
				{
					SchemaVersion: 1,
					Phase:         indexPatchPhaseAST,
					Project:       store.ProjectIdentity{Root: root, Name: "project"},
					Status:        "ok",
					Invalidates:   &IndexPatchInvalidation{Files: []string{"src/a.ts"}},
					Facts: IndexPatchFacts{
						Definitions: []store.ProjectDefinition{
							{ID: "prompt:new", Kind: "prompt", Name: "new", Fidelity: "resolved", Status: "active", Source: &store.SourceLoc{File: "src/a.ts", Line: 2}},
						},
						Sources: []store.IndexSourceFile{
							{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"prompt:new"}},
						},
					},
				},
			},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()
	service.ApplyIndexPatch(context.Background(), indexPatchFromSnapshot(previous, indexPatchPhaseAST, "ok"))

	index, err := service.ReindexProjectIncremental(context.Background(), root, "", "project", []string{"src/a.ts"}, []string{"src/deleted.ts"})
	if err != nil {
		t.Fatalf("ReindexProjectIncremental error = %v", err)
	}

	if !indexer.calledIncrement {
		t.Fatal("IndexProjectIncremental was not called")
	}
	if indexer.calledFull {
		t.Fatal("IndexProjectAstPatch called, want partial path")
	}
	if indexer.mode != "ast-and-semantic" {
		t.Fatalf("mode = %q, want ast-and-semantic", indexer.mode)
	}
	assertStringSet(t, indexer.files, []string{"src/a.ts"})
	assertStringSet(t, indexer.deletedFiles, []string{"src/deleted.ts"})
	if findDefinition(indexer.previous.Definitions, "prompt:old") == nil {
		t.Fatalf("previous index passed to worker missing old definition: %+v", indexer.previous.Definitions)
	}
	if findDefinition(index.Definitions, "prompt:old") != nil {
		t.Fatalf("stale definition survived incremental patch: %+v", index.Definitions)
	}
	if findDefinition(index.Definitions, "prompt:new") == nil {
		t.Fatalf("replacement definition missing: %+v", index.Definitions)
	}
	if findDefinition(index.Definitions, "prompt:kept") == nil {
		t.Fatalf("unrelated definition removed: %+v", index.Definitions)
	}
}

func TestReindexProjectIncrementalFallsBackWithoutPreviousSources(t *testing.T) {
	root := t.TempDir()
	indexer := &incrementalProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:full", Kind: "prompt", Name: "full", Fidelity: "partial", Status: "active"},
			},
			Sources: []store.IndexSourceFile{{File: "src/full.ts", Status: "active", DefinitionIDs: []string{"prompt:full"}}},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProjectIncremental(context.Background(), root, "", "project", []string{"src/a.ts"}, nil)
	if err != nil {
		t.Fatalf("ReindexProjectIncremental error = %v", err)
	}
	if indexer.calledIncrement {
		t.Fatal("IndexProjectIncremental called without previous source graph")
	}
	if !indexer.calledFull {
		t.Fatal("IndexProjectAstPatch was not called for fallback")
	}
	if findDefinition(index.Definitions, "prompt:full") == nil {
		t.Fatalf("fallback index missing full definition: %+v", index.Definitions)
	}
}

func TestReindexProjectAppliesSemanticNoOpPatch(t *testing.T) {
	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
			},
		},
		semanticPatch: IndexPatch{
			SchemaVersion: 1,
			Phase:         "semantic",
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			StartedAt:     "2026-06-02T10:00:01.000Z",
			FinishedAt:    "2026-06-02T10:00:01.001Z",
			Status:        "ok",
			Facts:         IndexPatchFacts{Diagnostics: []store.IndexDiagnostic{}},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if findDefinition(index.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want AST definition preserved", index.Definitions)
	}
	if index.Indexing == nil || index.Indexing.AST.Status != "ready" || index.Indexing.Semantic.Status != "ready" {
		t.Fatalf("indexing = %+v, want AST ready and semantic ready", index.Indexing)
	}
}

func TestReindexProjectSemanticReadyClearsStaticOnlyDiagnostic(t *testing.T) {
	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "resolved", Status: "active"},
			},
			Diagnostics: []store.IndexDiagnostic{
				{ID: "diagnostic:index:static-only", Severity: "warning", Code: "index.static_only", Message: "static only"},
			},
		},
		semanticPatch: IndexPatch{
			SchemaVersion: 1,
			Phase:         "semantic",
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			StartedAt:     "2026-06-02T10:00:01.000Z",
			FinishedAt:    "2026-06-02T10:00:01.001Z",
			Status:        "ok",
			Facts:         IndexPatchFacts{Diagnostics: []store.IndexDiagnostic{}},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if index.Indexing == nil || index.Indexing.Status != "ready" || index.Indexing.AST.Status != "ready" || index.Indexing.Semantic.Status != "ready" {
		t.Fatalf("indexing = %+v, want ready index after semantic enrichment clears static-only marker", index.Indexing)
	}
	for _, diagnostic := range index.Diagnostics {
		if diagnostic.Code == "index.static_only" {
			t.Fatalf("diagnostics = %+v, want static_only cleared after semantic ready", index.Diagnostics)
		}
	}
	if index.Indexing.AST.DiagnosticCount != 0 {
		t.Fatalf("ast diagnostic count = %d, want 0 after static_only clear", index.Indexing.AST.DiagnosticCount)
	}
}

func TestReindexProjectSemanticReadyClearsStaticOnlyDiagnosticWithOtherDiagnostics(t *testing.T) {
	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "resolved", Status: "active"},
			},
			Diagnostics: []store.IndexDiagnostic{
				{ID: "diagnostic:index:static-only", Severity: "warning", Code: "index.static_only", Message: "static only"},
				{ID: "relation.unresolved_reference:evaluation:writer", Severity: "warning", Code: "relation.unresolved_reference", Message: "unresolved relation"},
			},
		},
		semanticPatch: IndexPatch{
			SchemaVersion: 1,
			Phase:         "semantic",
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			StartedAt:     "2026-06-02T10:00:01.000Z",
			FinishedAt:    "2026-06-02T10:00:01.001Z",
			Status:        "ok",
			Facts:         IndexPatchFacts{Diagnostics: []store.IndexDiagnostic{}},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if index.Indexing == nil || index.Indexing.Status != "ready" || index.Indexing.AST.Status != "ready" || index.Indexing.Semantic.Status != "ready" {
		t.Fatalf("indexing = %+v, want ready index after semantic enrichment clears static-only marker", index.Indexing)
	}
	if index.Indexing.AST.DiagnosticCount != 1 {
		t.Fatalf("ast diagnostic count = %d, want remaining non-runtime diagnostic count", index.Indexing.AST.DiagnosticCount)
	}
	remainingDiagnostics := map[string]bool{}
	for _, diagnostic := range index.Diagnostics {
		remainingDiagnostics[diagnostic.Code] = true
	}
	if remainingDiagnostics["index.static_only"] {
		t.Fatalf("diagnostics = %+v, want static_only cleared after semantic ready", index.Diagnostics)
	}
	if !remainingDiagnostics["relation.unresolved_reference"] {
		t.Fatalf("diagnostics = %+v, want relation warning preserved", index.Diagnostics)
	}
}

func TestReindexProjectSemanticFailureDegradesSemanticOnly(t *testing.T) {
	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
			},
		},
		semanticErr: errors.New("semantic timeout"),
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v, want AST index kept after semantic failure", err)
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if findDefinition(index.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want AST definition preserved", index.Definitions)
	}
	if index.Indexing == nil || index.Indexing.AST.Status != "ready" || index.Indexing.Semantic.Status != "degraded" {
		t.Fatalf("indexing = %+v, want AST ready and semantic degraded", index.Indexing)
	}
	if index.Indexing.Status != "degraded" || index.Indexing.Error == "" {
		t.Fatalf("indexing = %+v, want top-level degraded semantic error", index.Indexing)
	}
}

func TestReindexProjectSemanticTimeoutDegradesSemanticOnly(t *testing.T) {
	oldTimeout := projectIndexSemanticTimeout
	projectIndexSemanticTimeout = 10 * time.Millisecond
	t.Cleanup(func() {
		projectIndexSemanticTimeout = oldTimeout
	})

	root := t.TempDir()
	indexer := &blockingSemanticProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
			},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	startedAt := time.Now()
	index, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v, want AST index kept after semantic timeout", err)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("ReindexProject elapsed = %s, want semantic timeout bounded", elapsed)
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if findDefinition(index.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want AST definition preserved", index.Definitions)
	}
	if index.Indexing == nil || index.Indexing.AST.Status != "ready" || index.Indexing.Semantic.Status != "degraded" {
		t.Fatalf("indexing = %+v, want AST ready and semantic degraded", index.Indexing)
	}
}

func TestReindexProjectSemanticBudgetOverrunDegradesSemanticOnly(t *testing.T) {
	oldBudget := projectIndexSemanticBudget
	projectIndexSemanticBudget = IndexPatchBudget{MaxDefinitions: 1}
	t.Cleanup(func() {
		projectIndexSemanticBudget = oldBudget
	})

	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		index: store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "resolved", Status: "active"},
			},
		},
		semanticPatch: IndexPatch{
			SchemaVersion: 1,
			Phase:         "semantic",
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			StartedAt:     "2026-06-02T10:00:01.000Z",
			FinishedAt:    "2026-06-02T10:00:01.001Z",
			Status:        "ok",
			Facts: IndexPatchFacts{
				Definitions: []store.ProjectDefinition{
					{ID: "prompt:one", Kind: "prompt", Name: "one", Fidelity: "resolved", Status: "active"},
					{ID: "prompt:two", Kind: "prompt", Name: "two", Fidelity: "resolved", Status: "active"},
				},
			},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectIndexer(indexer)
	defer service.Shutdown()

	index, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v, want AST index kept after semantic budget overrun", err)
	}
	if findDefinition(index.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want AST definition preserved", index.Definitions)
	}
	if findDefinition(index.Definitions, "prompt:one") != nil || findDefinition(index.Definitions, "prompt:two") != nil {
		t.Fatalf("definitions = %+v, want over-budget semantic definitions ignored", index.Definitions)
	}
	if index.Indexing == nil || index.Indexing.AST.Status != "ready" || index.Indexing.Semantic.Status != "degraded" {
		t.Fatalf("indexing = %+v, want AST ready and semantic degraded", index.Indexing)
	}
	if len(index.Diagnostics) == 0 || index.Diagnostics[0].Code != "index.semantic_budget_exceeded" {
		t.Fatalf("diagnostics = %+v, want semantic budget diagnostic", index.Diagnostics)
	}
}

func TestReindexProjectPublishesFailedIndexingStatus(t *testing.T) {
	root := t.TempDir()
	service := NewService(store.NewStore(), nil).WithProjectIndexer(failingProjectIndexer{})
	defer service.Shutdown()

	service.RegisterIndexSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:previous", Kind: "prompt", Name: "previous", Fidelity: "resolved", Status: "active"},
		},
	})

	if _, err := service.ReindexProject(context.Background(), root, "", "project"); err == nil {
		t.Fatal("ReindexProject error = nil, want worker failure")
	}

	index := service.indexReadModel()
	if index.Indexing == nil {
		t.Fatal("index.Indexing = nil, want failed indexing status")
	}
	if index.Indexing.Status != "failed" {
		t.Fatalf("index.Indexing.Status = %q, want failed", index.Indexing.Status)
	}
	if index.Indexing.AST.Status != "failed" {
		t.Fatalf("index.Indexing.AST.Status = %q, want failed", index.Indexing.AST.Status)
	}
	if index.Indexing.Error == "" {
		t.Fatal("index.Indexing.Error empty, want worker failure message")
	}
	if findDefinition(index.Definitions, "prompt:previous") == nil {
		t.Fatalf("definitions = %+v, want previous index preserved after failed reindex", index.Definitions)
	}
}

func TestRegisterIndexSnapshotDoesNotDowngradeIndexedIndex(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()

	ctx := context.Background()
	service.RegisterIndexSnapshot(ctx, store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: "/tmp/project", ConfigFile: "/tmp/project/crux.config.ts"},
		IndexedAt:     "2026-05-25T20:00:00Z",
		Prompts:       []store.PromptMeta{{ID: "indexed-prompt"}},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:indexed-prompt", Kind: "prompt", Name: "indexed-prompt partial", Fidelity: "partial", Status: "active"},
			{ID: "prompt:indexed-prompt", Kind: "prompt", Name: "indexed-prompt", Fidelity: "resolved", Status: "active"},
		},
		Relations: []store.ProjectRelation{
			{ID: "relation:prompt:indexed-prompt:prompt.uses_context:context:indexed", Type: "prompt.uses_context", From: "prompt:indexed-prompt", To: "context:indexed", Fidelity: "partial"},
			{ID: "relation:prompt:indexed-prompt:prompt.uses_context:context:indexed", Type: "prompt.uses_context", From: "prompt:indexed-prompt", To: "context:indexed", Fidelity: "partial"},
		},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:indexed", Severity: "info", Code: "index.static_partial", Message: "partial"},
		},
		Sources: []store.IndexSourceFile{{File: "/tmp/project/crux.config.ts", Status: "indexed"}},
	})

	service.RegisterIndexSnapshot(ctx, store.IndexData{
		SchemaVersion: 1,
		Prompts:       []store.PromptMeta{{ID: "runtime-prompt"}},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:runtime-prompt", Kind: "prompt", Name: "runtime-prompt", Fidelity: "resolved", Status: "active"},
		},
		Relations: []store.ProjectRelation{
			{ID: "relation:prompt.uses_context:prompt:indexed-prompt:context:indexed", Type: "prompt.uses_context", From: "prompt:indexed-prompt", To: "context:indexed", Fidelity: "resolved"},
		},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:index:static-only", Severity: "warning", Code: "index.static_only", Message: "static only"},
		},
	})

	index := service.indexReadModel()
	if index.Project == nil || index.Project.ConfigFile != "/tmp/project/crux.config.ts" {
		t.Fatalf("project = %+v, want indexed project identity preserved", index.Project)
	}
	if findDefinition(index.Definitions, "prompt:indexed-prompt") == nil {
		t.Fatalf("definitions = %+v, want indexed definition preserved", index.Definitions)
	}
	indexedCount := 0
	for _, definition := range index.Definitions {
		if definition.ID == "prompt:indexed-prompt" {
			indexedCount++
		}
	}
	if indexedCount != 1 {
		t.Fatalf("definitions = %+v, want one indexed definition", index.Definitions)
	}
	if findDefinition(index.Definitions, "prompt:runtime-prompt") == nil {
		t.Fatalf("definitions = %+v, want runtime definition merged", index.Definitions)
	}
	if len(index.Relations) != 1 || index.Relations[0].Fidelity != "resolved" {
		t.Fatalf("relations = %+v, want one resolved logical relation", index.Relations)
	}
	for _, diagnostic := range index.Diagnostics {
		if diagnostic.Code == "index.static_only" {
			t.Fatalf("diagnostics = %+v, want static_only filtered from runtime snapshot", index.Diagnostics)
		}
	}
}

func TestRegisterIndexSnapshotPreservesIndexedDefinitionSource(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()

	ctx := context.Background()
	column := 3
	source := &store.SourceLoc{File: "/tmp/project/prompts/writer.ts", Line: 12, Column: &column}
	schemaSource := store.SourceLoc{File: "/tmp/project/prompts/writer-schema.ts", Line: 4}
	service.RegisterIndexSnapshot(ctx, store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{
				ID:            "prompt:writer",
				Kind:          "prompt",
				Name:          "writer",
				Fidelity:      "partial",
				Status:        "active",
				Source:        source,
				SourceSnippet: &store.SourceSnippet{Source: "prompt({ id: 'writer' })", Language: "typescript", Range: store.SourceRange{File: source.File, StartLine: 12}},
				SourceRefs: []store.ProjectSourceRef{
					{
						ID:       "prompt:writer:source:schema:input:writerSchema",
						Role:     "schema",
						Property: "input",
						Symbol:   "writerSchema",
						Source:   schemaSource,
						Snippet:  &store.SourceSnippet{Source: "export const writerSchema = z.object({})", Language: "typescript", Range: store.SourceRange{File: schemaSource.File, StartLine: 4}},
						Fidelity: "resolved",
						Metadata: json.RawMessage(`{"schemaKind":"zod","parsedSchema":true}`),
					},
				},
				Metadata: json.RawMessage(`{"inputSchema":{"type":"object"}}`),
			},
		},
	})

	service.RegisterIndexSnapshot(ctx, store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
				Metadata: json.RawMessage(`{"hasOutput":false}`),
			},
		},
	})

	definition := findDefinition(service.indexReadModel().Definitions, "prompt:writer")
	if definition == nil {
		t.Fatal("definition prompt:writer missing")
	}
	if definition.Source == nil || definition.Source.File != source.File || definition.Source.Line != source.Line {
		t.Fatalf("source = %+v, want indexed source preserved", definition.Source)
	}
	if definition.SourceSnippet == nil {
		t.Fatal("source snippet missing, want indexed snippet preserved")
	}
	if len(definition.SourceRefs) != 1 {
		t.Fatalf("source refs = %+v, want indexed source ref preserved", definition.SourceRefs)
	}
	if definition.SourceRefs[0].Source.File != schemaSource.File || definition.SourceRefs[0].Symbol != "writerSchema" {
		t.Fatalf("source ref = %+v, want indexed schema ref preserved", definition.SourceRefs[0])
	}
	var metadata map[string]any
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("metadata unmarshal error = %v", err)
	}
	if metadata["inputSchema"] == nil || metadata["hasOutput"] != false {
		t.Fatalf("metadata = %+v, want merged indexed and runtime metadata", metadata)
	}
}

func TestIndexReadModelAddsDefinitionUpdatedMetadataFromSourceMtime(t *testing.T) {
	root := t.TempDir()
	sourceFile := filepath.Join(root, "prompt.ts")
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'writer' })\n"), 0o644); err != nil {
		t.Fatalf("write source file: %v", err)
	}

	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()
	service.RegisterIndexSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{{
			ID:       "prompt:writer",
			Kind:     "prompt",
			Name:     "writer",
			Fidelity: "resolved",
			Status:   "active",
			Source:   &store.SourceLoc{File: "prompt.ts", Line: 1},
			Metadata: json.RawMessage(`{"facts":{"kind":"prompt"}}`),
		}},
	})

	definition := findDefinition(service.indexReadModel().Definitions, "prompt:writer")
	if definition == nil {
		t.Fatal("prompt:writer definition missing")
	}
	var metadata map[string]any
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("metadata JSON: %v", err)
	}
	if metadata["facts"] == nil {
		t.Fatalf("metadata = %+v, want existing facts preserved", metadata)
	}
	updated, ok := metadata["updated"].(map[string]any)
	if !ok {
		t.Fatalf("metadata = %+v, want updated object", metadata)
	}
	if updated["sourceMtime"] != true || updated["lastEditedAt"] == "" || updated["lastEditedAtMs"] == nil {
		t.Fatalf("updated = %+v, want source mtime fields", updated)
	}
}

func TestIndexReadModelProjectsSafetyRelationTargetsIntoFacts(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()
	service.RegisterIndexSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{
				ID:       "constraint:safe-tone",
				Kind:     "constraint",
				Name:     "safe-tone",
				Fidelity: "resolved",
				Status:   "active",
				Metadata: json.RawMessage(`{"facts":{"kind":"constraint","severity":"assert"}}`),
			},
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved", Status: "active"},
		},
		Relations: []store.ProjectRelation{
			{ID: "rel:1", Type: "constraint.applies_to", From: "constraint:safe-tone", To: "prompt:writer", Fidelity: "resolved"},
		},
	})

	definition := findDefinition(service.indexReadModel().Definitions, "constraint:safe-tone")
	if definition == nil {
		t.Fatal("constraint:safe-tone definition missing")
	}
	var metadata map[string]any
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("metadata JSON: %v", err)
	}
	facts, ok := metadata["facts"].(map[string]any)
	if !ok {
		t.Fatalf("metadata = %+v, want facts", metadata)
	}
	appliesTo, ok := facts["appliesTo"].([]any)
	if !ok || len(appliesTo) != 1 || appliesTo[0] != "prompt:writer" {
		t.Fatalf("facts = %+v, want appliesTo prompt:writer", facts)
	}
}

type staticOnlyProjectIndexer struct{}

func (staticOnlyProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string, staticOnly bool) (IndexPatch, error) {
	return indexPatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: projectName},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:static", Kind: "prompt", Name: "static", Fidelity: "resolved", Status: "active"},
		},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:index:static-only", Severity: "warning", Code: "index.static_only", Message: "static only"},
		},
	}, indexPatchPhaseAST, "ok"), nil
}

func TestReindexProjectUsesResolvedStaticAstIndex(t *testing.T) {
	root := t.TempDir()
	service := NewService(store.NewStore(), nil).WithProjectIndexer(staticOnlyProjectIndexer{})
	defer service.Shutdown()

	ctx := context.Background()
	service.RegisterIndexSnapshot(ctx, store.IndexData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:indexed", Kind: "prompt", Name: "indexed", Fidelity: "resolved", Status: "active"},
		},
	})

	index, err := service.ReindexProject(ctx, root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if findDefinition(index.Definitions, "prompt:static") == nil {
		t.Fatalf("definitions = %+v, want resolved AST definition applied", index.Definitions)
	}
	if !isStaticOnlyIndex(index) {
		t.Fatalf("diagnostics = %+v, want static_only status preserved", index.Diagnostics)
	}
}

func TestServicePublishesIndexQualityOnStoreChange(t *testing.T) {
	s := store.NewStore()
	service := NewService(s, nil)
	defer service.Shutdown()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.IndexEvents().Subscribe(ctx)

	promptID := "writer.prompt"
	service.RegisterIndexSnapshot(ctx, store.IndexData{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer.prompt", Kind: "prompt", Name: "writer", Fidelity: "resolved"},
		},
	})
	readIndexEvent(t, events)

	s.EvalStart(store.EvalStartEvent{EvalID: "writer-eval", PromptID: &promptID, StartedAt: 42, TotalCases: 1})

	definition := readIndexDefinitionWithQuality(t, events, "prompt:writer.prompt")
	if definition.Quality.RunCount != 1 || definition.Quality.LastRunID != "writer-eval" {
		t.Fatalf("published quality = %+v", definition.Quality)
	}
}

func TestServiceIndexReadModelPreservesLintFindings(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.IndexEvents().Subscribe(ctx)

	source := &store.SourceLoc{File: "/tmp/project/tool.ts", Line: 12}
	service.RegisterIndexSnapshot(ctx, store.IndexData{
		SchemaVersion: 1,
		LintFindings: []store.IndexLintFinding{
			{
				ID:                   "lint:tool:search",
				Severity:             "warning",
				RuleID:               "tool.missing_input_schema",
				Category:             "contracts",
				Maturity:             "stable",
				Confidence:           "high",
				Profiles:             []string{"recommended", "strict"},
				Title:                "Tool has no input schema",
				Message:              "search has no parameters schema.",
				Rationale:            "Typed tool inputs let users inspect model intent before execution.",
				Source:               source,
				PrimaryDefinitionID:  "tool:search",
				RelatedDefinitionIDs: []string{"tool:search"},
				Evidence: []store.IndexLintEvidence{
					{Kind: "definition", Label: "Tool definition", DefinitionID: "tool:search", Source: source},
				},
				Fixes: []store.IndexLintFix{
					{Kind: "manual", Title: "Declare parameters", Description: "Add a Zod parameters schema."},
				},
				DocsURL: "/docs/reference/crux-core/index-lints/tool-missing-input-schema",
			},
		},
	})

	index := readIndexEvent(t, events)
	if len(index.LintFindings) != 1 {
		t.Fatalf("lint findings = %+v, want one", index.LintFindings)
	}
	finding := index.LintFindings[0]
	if finding.RuleID != "tool.missing_input_schema" || finding.Rationale == "" || len(finding.Profiles) != 2 {
		t.Fatalf("lint finding = %+v, want full backend-owned fields preserved", finding)
	}
	if len(finding.Evidence) != 1 || len(finding.Fixes) != 1 {
		t.Fatalf("lint evidence/fixes = %+v / %+v", finding.Evidence, finding.Fixes)
	}
}

func readIndexEvent(t *testing.T, events <-chan store.IndexData) store.IndexData {
	t.Helper()
	select {
	case index := <-events:
		return index
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for index event")
		return store.IndexData{}
	}
}

func writeTestIndexCache(t *testing.T, root string, index store.IndexData) {
	t.Helper()
	writeIndexCache(root, index)
	if _, ok := readTestIndexCache(t, root); !ok {
		t.Fatalf("failed to write test index cache under %s", root)
	}
}

func readTestIndexCache(t *testing.T, root string) (store.IndexData, bool) {
	t.Helper()
	data, err := os.ReadFile(indexCacheFile(root))
	if err != nil {
		return store.IndexData{}, false
	}
	var index store.IndexData
	if err := json.Unmarshal(data, &index); err != nil {
		t.Fatalf("unmarshal test index cache error = %v", err)
	}
	return index, true
}

func readIndexDefinitionWithQuality(t *testing.T, events <-chan store.IndexData, id string) *store.ProjectDefinition {
	t.Helper()
	timeout := time.After(time.Second)
	for {
		select {
		case index := <-events:
			definition := findDefinition(index.Definitions, id)
			if definition != nil && definition.Quality != nil {
				return definition
			}
		case <-timeout:
			t.Fatalf("timed out waiting for index quality on %s", id)
			return nil
		}
	}
}

func findDefinition(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}
