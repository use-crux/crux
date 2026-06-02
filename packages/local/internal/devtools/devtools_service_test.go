package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type recordingProjectIndexer struct {
	deadline    time.Time
	hasDeadline bool
}

type failingProjectIndexer struct{}

func (failingProjectIndexer) IndexProject(context.Context, string, string, string) (store.CatalogData, error) {
	return store.CatalogData{}, errors.New("index worker failed")
}

func (r *recordingProjectIndexer) IndexProject(ctx context.Context, root, configPath, projectName string) (store.CatalogData, error) {
	r.deadline, r.hasDeadline = ctx.Deadline()
	return store.CatalogData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: projectName},
		IndexedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		Definitions:   []store.ProjectDefinition{},
		Relations:     []store.ProjectRelation{},
		Diagnostics:   []store.CatalogDiagnostic{},
		Sources:       []store.CatalogSourceFile{},
	}, nil
}

func TestServiceReindexProjectDefaultDeadlineAllowsRichDiscovery(t *testing.T) {
	indexer := &recordingProjectIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	start := time.Now()
	if _, err := service.ReindexProject(context.Background(), "/tmp/project", "", "project"); err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if !indexer.hasDeadline {
		t.Fatal("IndexProject context had no deadline")
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
	indexer := &recordingProjectIndexer{}
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(indexer)
	defer service.Shutdown()

	catalog, err := service.ReindexProject(context.Background(), "/tmp/project", "", "project")
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

func TestReindexProjectPublishesFailedIndexingStatus(t *testing.T) {
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(failingProjectIndexer{})
	defer service.Shutdown()

	service.RegisterCatalogSnapshot(context.Background(), store.CatalogData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:previous", Kind: "prompt", Name: "previous", Fidelity: "resolved", Status: "active"},
		},
	})

	if _, err := service.ReindexProject(context.Background(), "/tmp/project", "", "project"); err == nil {
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

func (staticOnlyProjectIndexer) IndexProject(ctx context.Context, root, configPath, projectName string) (store.CatalogData, error) {
	return store.CatalogData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: projectName},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:static", Kind: "prompt", Name: "static", Fidelity: "partial", Status: "active"},
		},
		Diagnostics: []store.CatalogDiagnostic{
			{ID: "diagnostic:catalog:static-only", Severity: "warning", Code: "catalog.static_only", Message: "static only"},
		},
	}, nil
}

func TestReindexProjectDoesNotDowngradeResolvedCatalogWithStaticFallback(t *testing.T) {
	service := NewService(store.NewStore(), nil).WithProjectCatalogIndexer(staticOnlyProjectIndexer{})
	defer service.Shutdown()

	ctx := context.Background()
	service.RegisterCatalogSnapshot(ctx, store.CatalogData{
		SchemaVersion: 1,
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:indexed", Kind: "prompt", Name: "indexed", Fidelity: "resolved", Status: "active"},
		},
	})

	catalog, err := service.ReindexProject(ctx, "/tmp/project", "", "project")
	if err != nil {
		t.Fatalf("ReindexProject error = %v", err)
	}
	if findDefinition(catalog.Definitions, "prompt:indexed") == nil {
		t.Fatalf("definitions = %+v, want resolved definition preserved", catalog.Definitions)
	}
	if findDefinition(catalog.Definitions, "prompt:static") != nil {
		t.Fatalf("definitions = %+v, want static fallback ignored", catalog.Definitions)
	}
	for _, diagnostic := range catalog.Diagnostics {
		if diagnostic.Code == "catalog.static_only" {
			t.Fatalf("diagnostics = %+v, want no static_only warning", catalog.Diagnostics)
		}
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
