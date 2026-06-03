package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
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

func (failingProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (CatalogPatch, error) {
	return CatalogPatch{}, errors.New("index worker failed")
}

type staticCatalogProjectIndexer struct {
	catalog store.CatalogData
}

func (i staticCatalogProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (CatalogPatch, error) {
	return catalogPatchFromSnapshot(i.catalog, catalogPatchPhaseAST, "ok"), nil
}

type blockingProjectIndexer struct {
	catalog store.CatalogData
	started chan struct{}
	release chan struct{}
}

type semanticPatchProjectIndexer struct {
	catalog        store.CatalogData
	semanticPatch  CatalogPatch
	semanticErr    error
	calledSemantic bool
}

type blockingSemanticProjectIndexer struct {
	catalog        store.CatalogData
	calledSemantic bool
}

func (i *blockingSemanticProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (CatalogPatch, error) {
	return catalogPatchFromSnapshot(i.catalog, catalogPatchPhaseAST, "ok"), nil
}

func (i *blockingSemanticProjectIndexer) IndexProjectSemanticPatch(ctx context.Context, root, configPath, projectName string, budget CatalogPatchBudget) (CatalogPatch, error) {
	i.calledSemantic = true
	<-ctx.Done()
	return CatalogPatch{}, ctx.Err()
}

func (i *semanticPatchProjectIndexer) IndexProjectAstPatch(context.Context, string, string, string, bool) (CatalogPatch, error) {
	return catalogPatchFromSnapshot(i.catalog, catalogPatchPhaseAST, "ok"), nil
}

func (i *semanticPatchProjectIndexer) IndexProjectSemanticPatch(context.Context, string, string, string, CatalogPatchBudget) (CatalogPatch, error) {
	i.calledSemantic = true
	if i.semanticErr != nil {
		return CatalogPatch{}, i.semanticErr
	}
	return i.semanticPatch, nil
}

func newBlockingProjectIndexer(catalog store.CatalogData) *blockingProjectIndexer {
	return &blockingProjectIndexer{
		catalog: catalog,
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (i *blockingProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string, staticOnly bool) (CatalogPatch, error) {
	select {
	case <-i.started:
	default:
		close(i.started)
	}
	select {
	case <-ctx.Done():
		return CatalogPatch{}, ctx.Err()
	case <-i.release:
		if i.catalog.Project == nil {
			i.catalog.Project = &store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
		}
		return catalogPatchFromSnapshot(i.catalog, catalogPatchPhaseAST, "ok"), nil
	}
}

func (r *recordingProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string, staticOnly bool) (CatalogPatch, error) {
	r.deadline, r.hasDeadline = ctx.Deadline()
	r.staticOnly = staticOnly
	return catalogPatchFromSnapshot(store.CatalogData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: projectName},
		IndexedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		Definitions:   []store.ProjectDefinition{},
		Relations:     []store.ProjectRelation{},
		Diagnostics:   []store.CatalogDiagnostic{},
		Sources:       []store.CatalogSourceFile{},
	}, catalogPatchPhaseAST, "ok"), nil
}

func TestServiceReindexProjectDefaultDeadlineAllowsAstDiscovery(t *testing.T) {
	root := t.TempDir()
	indexer := &recordingProjectIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
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
	if remaining < 55*time.Second || remaining > defaultProjectCatalogReindexTimeout {
		t.Fatalf("IndexProject deadline remaining = %s, want about %s", remaining, defaultProjectCatalogReindexTimeout)
	}
	if indexer.deadline.Before(start.Add(55 * time.Second)) {
		t.Fatalf("IndexProject deadline = %s, want at least 55s from start", indexer.deadline)
	}
}

func TestReindexProjectPublishesIndexingStatus(t *testing.T) {
	root := t.TempDir()
	indexer := &recordingProjectIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	catalog, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if catalog.Indexing == nil {
		t.Fatal("catalog.Indexing = nil, want backend-owned indexing status")
	}
	if catalog.Indexing.Status != "ready" {
		t.Fatalf("catalog.Indexing.Status = %q, want ready", catalog.Indexing.Status)
	}
	if catalog.Indexing.AST.Status != "ready" {
		t.Fatalf("catalog.Indexing.AST.Status = %q, want ready", catalog.Indexing.AST.Status)
	}
	if catalog.Indexing.Semantic.Status != "disabled" {
		t.Fatalf("catalog.Indexing.Semantic.Status = %q, want disabled", catalog.Indexing.Semantic.Status)
	}
	if catalog.Indexing.AST.IndexedAt == "" {
		t.Fatal("catalog.Indexing.AST.IndexedAt empty, want source index timestamp")
	}
}

func TestReindexProjectPublishesCachedCatalogBeforeSlowRefresh(t *testing.T) {
	root := t.TempDir()
	writeTestCatalogCache(t, root, store.CatalogData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		IndexedAt:     "2026-06-01T10:00:00.000Z",
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:cached", Kind: "prompt", Name: "cached", Fidelity: "resolved", Status: "active"},
		},
	})
	indexer := newBlockingProjectIndexer(store.CatalogData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "project"},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
		},
	})
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.CatalogEvents().Subscribe(ctx)
	done := make(chan error, 1)
	go func() {
		_, err := service.ReindexProject(ctx, root, "", "project")
		done <- err
	}()
	<-indexer.started

	cached := readCatalogEvent(t, events)
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
	final := readCatalogEvent(t, events)
	if findDefinition(final.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want fresh definition after refresh", final.Definitions)
	}
	if findDefinition(final.Definitions, "prompt:cached") != nil {
		t.Fatalf("definitions = %+v, want fresh AST refresh to replace stale cache", final.Definitions)
	}
}

func TestReindexProjectWritesCatalogCacheBestEffort(t *testing.T) {
	root := t.TempDir()
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(staticCatalogProjectIndexer{
		catalog: store.CatalogData{
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

	catalog, ok := readTestCatalogCache(t, root)
	if !ok {
		t.Fatal("catalog cache missing after successful reindex")
	}
	if findDefinition(catalog.Definitions, "prompt:fresh") == nil {
		t.Fatalf("cache definitions = %+v, want fresh definition", catalog.Definitions)
	}
	if catalog.Indexing == nil || catalog.Indexing.Status != "ready" {
		t.Fatalf("cache indexing = %+v, want final ready snapshot", catalog.Indexing)
	}
}

func TestReindexProjectAppliesSemanticNoOpPatch(t *testing.T) {
	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		catalog: store.CatalogData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
			},
		},
		semanticPatch: CatalogPatch{
			SchemaVersion: 1,
			Phase:         "semantic",
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			StartedAt:     "2026-06-02T10:00:01.000Z",
			FinishedAt:    "2026-06-02T10:00:01.001Z",
			Status:        "ok",
			Facts:         CatalogPatchFacts{Diagnostics: []store.CatalogDiagnostic{}},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	catalog, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if findDefinition(catalog.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want AST definition preserved", catalog.Definitions)
	}
	if catalog.Indexing == nil || catalog.Indexing.AST.Status != "ready" || catalog.Indexing.Semantic.Status != "ready" {
		t.Fatalf("indexing = %+v, want AST ready and semantic ready", catalog.Indexing)
	}
}

func TestReindexProjectSemanticReadyClearsStaticOnlyDiagnostic(t *testing.T) {
	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		catalog: store.CatalogData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "resolved", Status: "active"},
			},
			Diagnostics: []store.CatalogDiagnostic{
				{ID: "diagnostic:catalog:static-only", Severity: "warning", Code: "catalog.static_only", Message: "static only"},
			},
		},
		semanticPatch: CatalogPatch{
			SchemaVersion: 1,
			Phase:         "semantic",
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			StartedAt:     "2026-06-02T10:00:01.000Z",
			FinishedAt:    "2026-06-02T10:00:01.001Z",
			Status:        "ok",
			Facts:         CatalogPatchFacts{Diagnostics: []store.CatalogDiagnostic{}},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	catalog, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if catalog.Indexing == nil || catalog.Indexing.Status != "ready" || catalog.Indexing.AST.Status != "ready" || catalog.Indexing.Semantic.Status != "ready" {
		t.Fatalf("indexing = %+v, want ready catalog after semantic enrichment clears static-only marker", catalog.Indexing)
	}
	for _, diagnostic := range catalog.Diagnostics {
		if diagnostic.Code == "catalog.static_only" {
			t.Fatalf("diagnostics = %+v, want static_only cleared after semantic ready", catalog.Diagnostics)
		}
	}
	if catalog.Indexing.AST.DiagnosticCount != 0 {
		t.Fatalf("ast diagnostic count = %d, want 0 after static_only clear", catalog.Indexing.AST.DiagnosticCount)
	}
}

func TestReindexProjectSemanticFailureDegradesSemanticOnly(t *testing.T) {
	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		catalog: store.CatalogData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
			},
		},
		semanticErr: errors.New("semantic timeout"),
	}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	catalog, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v, want AST catalog kept after semantic failure", err)
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if findDefinition(catalog.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want AST definition preserved", catalog.Definitions)
	}
	if catalog.Indexing == nil || catalog.Indexing.AST.Status != "ready" || catalog.Indexing.Semantic.Status != "degraded" {
		t.Fatalf("indexing = %+v, want AST ready and semantic degraded", catalog.Indexing)
	}
	if catalog.Indexing.Status != "degraded" || catalog.Indexing.Error == "" {
		t.Fatalf("indexing = %+v, want top-level degraded semantic error", catalog.Indexing)
	}
}

func TestReindexProjectSemanticTimeoutDegradesSemanticOnly(t *testing.T) {
	oldTimeout := projectCatalogSemanticTimeout
	projectCatalogSemanticTimeout = 10 * time.Millisecond
	t.Cleanup(func() {
		projectCatalogSemanticTimeout = oldTimeout
	})

	root := t.TempDir()
	indexer := &blockingSemanticProjectIndexer{
		catalog: store.CatalogData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "partial", Status: "active"},
			},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	startedAt := time.Now()
	catalog, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v, want AST catalog kept after semantic timeout", err)
	}
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("ReindexProject elapsed = %s, want semantic timeout bounded", elapsed)
	}
	if !indexer.calledSemantic {
		t.Fatal("semantic patch indexer was not called")
	}
	if findDefinition(catalog.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want AST definition preserved", catalog.Definitions)
	}
	if catalog.Indexing == nil || catalog.Indexing.AST.Status != "ready" || catalog.Indexing.Semantic.Status != "degraded" {
		t.Fatalf("indexing = %+v, want AST ready and semantic degraded", catalog.Indexing)
	}
}

func TestReindexProjectSemanticBudgetOverrunDegradesSemanticOnly(t *testing.T) {
	oldBudget := projectCatalogSemanticBudget
	projectCatalogSemanticBudget = CatalogPatchBudget{MaxDefinitions: 1}
	t.Cleanup(func() {
		projectCatalogSemanticBudget = oldBudget
	})

	root := t.TempDir()
	indexer := &semanticPatchProjectIndexer{
		catalog: store.CatalogData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: root, Name: "project"},
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:fresh", Kind: "prompt", Name: "fresh", Fidelity: "resolved", Status: "active"},
			},
		},
		semanticPatch: CatalogPatch{
			SchemaVersion: 1,
			Phase:         "semantic",
			Project:       store.ProjectIdentity{Root: root, Name: "project"},
			StartedAt:     "2026-06-02T10:00:01.000Z",
			FinishedAt:    "2026-06-02T10:00:01.001Z",
			Status:        "ok",
			Facts: CatalogPatchFacts{
				Definitions: []store.ProjectDefinition{
					{ID: "prompt:one", Kind: "prompt", Name: "one", Fidelity: "resolved", Status: "active"},
					{ID: "prompt:two", Kind: "prompt", Name: "two", Fidelity: "resolved", Status: "active"},
				},
			},
		},
	}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	catalog, err := service.ReindexProject(context.Background(), root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v, want AST catalog kept after semantic budget overrun", err)
	}
	if findDefinition(catalog.Definitions, "prompt:fresh") == nil {
		t.Fatalf("definitions = %+v, want AST definition preserved", catalog.Definitions)
	}
	if findDefinition(catalog.Definitions, "prompt:one") != nil || findDefinition(catalog.Definitions, "prompt:two") != nil {
		t.Fatalf("definitions = %+v, want over-budget semantic definitions ignored", catalog.Definitions)
	}
	if catalog.Indexing == nil || catalog.Indexing.AST.Status != "ready" || catalog.Indexing.Semantic.Status != "degraded" {
		t.Fatalf("indexing = %+v, want AST ready and semantic degraded", catalog.Indexing)
	}
	if len(catalog.Diagnostics) == 0 || catalog.Diagnostics[0].Code != "catalog.semantic_budget_exceeded" {
		t.Fatalf("diagnostics = %+v, want semantic budget diagnostic", catalog.Diagnostics)
	}
}

func TestReindexProjectPublishesFailedIndexingStatus(t *testing.T) {
	root := t.TempDir()
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(failingProjectIndexer{})
	defer service.Shutdown()

	service.RegisterCatalogSnapshot(context.Background(), store.CatalogData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:previous", Kind: "prompt", Name: "previous", Fidelity: "resolved", Status: "active"},
		},
	})

	if _, err := service.ReindexProject(context.Background(), root, "", "project"); err == nil {
		t.Fatal("ReindexProject error = nil, want worker failure")
	}

	catalog := service.catalogReadModel()
	if catalog.Indexing == nil {
		t.Fatal("catalog.Indexing = nil, want failed indexing status")
	}
	if catalog.Indexing.Status != "failed" {
		t.Fatalf("catalog.Indexing.Status = %q, want failed", catalog.Indexing.Status)
	}
	if catalog.Indexing.AST.Status != "failed" {
		t.Fatalf("catalog.Indexing.AST.Status = %q, want failed", catalog.Indexing.AST.Status)
	}
	if catalog.Indexing.Error == "" {
		t.Fatal("catalog.Indexing.Error empty, want worker failure message")
	}
	if findDefinition(catalog.Definitions, "prompt:previous") == nil {
		t.Fatalf("definitions = %+v, want previous catalog preserved after failed reindex", catalog.Definitions)
	}
}

func TestRegisterCatalogSnapshotDoesNotDowngradeIndexedCatalog(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()

	ctx := context.Background()
	service.RegisterCatalogSnapshot(ctx, store.CatalogData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: "/tmp/project", ConfigFile: "/tmp/project/crux.config.ts"},
		IndexedAt:     "2026-05-25T20:00:00Z",
		Prompts:       []store.PromptMeta{{ID: "indexed-prompt"}},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:indexed-prompt", Kind: "prompt", Name: "indexed-prompt", Fidelity: "resolved", Status: "active"},
		},
		Relations: []store.ProjectRelation{
			{ID: "relation:indexed", Type: "prompt.uses_context", From: "prompt:indexed-prompt", To: "context:indexed", Fidelity: "resolved"},
		},
		Diagnostics: []store.CatalogDiagnostic{
			{ID: "diagnostic:indexed", Severity: "info", Code: "catalog.static_partial", Message: "partial"},
		},
		Sources: []store.CatalogSourceFile{{File: "/tmp/project/crux.config.ts", Status: "indexed"}},
	})

	service.RegisterCatalogSnapshot(ctx, store.CatalogData{
		SchemaVersion: 1,
		Prompts:       []store.PromptMeta{{ID: "runtime-prompt"}},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:runtime-prompt", Kind: "prompt", Name: "runtime-prompt", Fidelity: "resolved", Status: "active"},
		},
		Diagnostics: []store.CatalogDiagnostic{
			{ID: "diagnostic:catalog:static-only", Severity: "warning", Code: "catalog.static_only", Message: "static only"},
		},
	})

	catalog := service.catalogReadModel()
	if catalog.Project == nil || catalog.Project.ConfigFile != "/tmp/project/crux.config.ts" {
		t.Fatalf("project = %+v, want indexed project identity preserved", catalog.Project)
	}
	if findDefinition(catalog.Definitions, "prompt:indexed-prompt") == nil {
		t.Fatalf("definitions = %+v, want indexed definition preserved", catalog.Definitions)
	}
	if findDefinition(catalog.Definitions, "prompt:runtime-prompt") == nil {
		t.Fatalf("definitions = %+v, want runtime definition merged", catalog.Definitions)
	}
	for _, diagnostic := range catalog.Diagnostics {
		if diagnostic.Code == "catalog.static_only" {
			t.Fatalf("diagnostics = %+v, want static_only filtered from runtime snapshot", catalog.Diagnostics)
		}
	}
}

func TestRegisterCatalogSnapshotPreservesIndexedDefinitionSource(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()

	ctx := context.Background()
	column := 3
	source := &store.SourceLoc{File: "/tmp/project/prompts/writer.ts", Line: 12, Column: &column}
	schemaSource := store.SourceLoc{File: "/tmp/project/prompts/writer-schema.ts", Line: 4}
	service.RegisterCatalogSnapshot(ctx, store.CatalogData{
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

	service.RegisterCatalogSnapshot(ctx, store.CatalogData{
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

	definition := findDefinition(service.catalogReadModel().Definitions, "prompt:writer")
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

type staticOnlyProjectIndexer struct{}

func (staticOnlyProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string, staticOnly bool) (CatalogPatch, error) {
	return catalogPatchFromSnapshot(store.CatalogData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: projectName},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:static", Kind: "prompt", Name: "static", Fidelity: "resolved", Status: "active"},
		},
		Diagnostics: []store.CatalogDiagnostic{
			{ID: "diagnostic:catalog:static-only", Severity: "warning", Code: "catalog.static_only", Message: "static only"},
		},
	}, catalogPatchPhaseAST, "ok"), nil
}

func TestReindexProjectUsesResolvedStaticAstCatalog(t *testing.T) {
	root := t.TempDir()
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(staticOnlyProjectIndexer{})
	defer service.Shutdown()

	ctx := context.Background()
	service.RegisterCatalogSnapshot(ctx, store.CatalogData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:indexed", Kind: "prompt", Name: "indexed", Fidelity: "resolved", Status: "active"},
		},
	})

	catalog, err := service.ReindexProject(ctx, root, "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if findDefinition(catalog.Definitions, "prompt:static") == nil {
		t.Fatalf("definitions = %+v, want resolved AST definition applied", catalog.Definitions)
	}
	if !isStaticOnlyCatalog(catalog) {
		t.Fatalf("diagnostics = %+v, want static_only status preserved", catalog.Diagnostics)
	}
}

func TestServicePublishesCatalogQualityOnStoreChange(t *testing.T) {
	s := store.NewStore()
	service := NewService(s, nil)
	defer service.Shutdown()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.CatalogEvents().Subscribe(ctx)

	promptID := "writer.prompt"
	service.RegisterCatalogSnapshot(ctx, store.CatalogData{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer.prompt", Kind: "prompt", Name: "writer", Fidelity: "resolved"},
		},
	})
	readCatalogEvent(t, events)

	s.EvalStart(store.EvalStartEvent{EvalID: "writer-eval", PromptID: &promptID, StartedAt: 42, TotalCases: 1})

	definition := readCatalogDefinitionWithQuality(t, events, "prompt:writer.prompt")
	if definition.Quality.RunCount != 1 || definition.Quality.LastRunID != "writer-eval" {
		t.Fatalf("published quality = %+v", definition.Quality)
	}
}

func TestServiceCatalogReadModelPreservesLintFindings(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.CatalogEvents().Subscribe(ctx)

	source := &store.SourceLoc{File: "/tmp/project/tool.ts", Line: 12}
	service.RegisterCatalogSnapshot(ctx, store.CatalogData{
		SchemaVersion: 1,
		LintFindings: []store.CatalogLintFinding{
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
				Evidence: []store.CatalogLintEvidence{
					{Kind: "definition", Label: "Tool definition", DefinitionID: "tool:search", Source: source},
				},
				Fixes: []store.CatalogLintFix{
					{Kind: "manual", Title: "Declare parameters", Description: "Add a Zod parameters schema."},
				},
				DocsURL: "/docs/reference/crux-core/catalog-lints/tool-missing-input-schema",
			},
		},
	})

	catalog := readCatalogEvent(t, events)
	if len(catalog.LintFindings) != 1 {
		t.Fatalf("lint findings = %+v, want one", catalog.LintFindings)
	}
	finding := catalog.LintFindings[0]
	if finding.RuleID != "tool.missing_input_schema" || finding.Rationale == "" || len(finding.Profiles) != 2 {
		t.Fatalf("lint finding = %+v, want full backend-owned fields preserved", finding)
	}
	if len(finding.Evidence) != 1 || len(finding.Fixes) != 1 {
		t.Fatalf("lint evidence/fixes = %+v / %+v", finding.Evidence, finding.Fixes)
	}
}

func readCatalogEvent(t *testing.T, events <-chan store.CatalogData) store.CatalogData {
	t.Helper()
	select {
	case catalog := <-events:
		return catalog
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for catalog event")
		return store.CatalogData{}
	}
}

func writeTestCatalogCache(t *testing.T, root string, catalog store.CatalogData) {
	t.Helper()
	writeCatalogCache(root, catalog)
	if _, ok := readTestCatalogCache(t, root); !ok {
		t.Fatalf("failed to write test catalog cache under %s", root)
	}
}

func readTestCatalogCache(t *testing.T, root string) (store.CatalogData, bool) {
	t.Helper()
	data, err := os.ReadFile(catalogCacheFile(root))
	if err != nil {
		return store.CatalogData{}, false
	}
	var catalog store.CatalogData
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatalf("unmarshal test catalog cache error = %v", err)
	}
	return catalog, true
}

func readCatalogDefinitionWithQuality(t *testing.T, events <-chan store.CatalogData, id string) *store.ProjectDefinition {
	t.Helper()
	timeout := time.After(time.Second)
	for {
		select {
		case catalog := <-events:
			definition := findDefinition(catalog.Definitions, id)
			if definition != nil && definition.Quality != nil {
				return definition
			}
		case <-timeout:
			t.Fatalf("timed out waiting for catalog quality on %s", id)
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
