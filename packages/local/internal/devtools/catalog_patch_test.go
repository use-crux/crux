package devtools

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestApplyCatalogPatchLetsASTReplaceCachedDefinitionFields(t *testing.T) {
	state := applyCatalogPatch(emptyCatalogPatchState(), CatalogPatch{
		SchemaVersion: 1,
		Phase:         "cache",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:00.000Z",
		FinishedAt:    "2026-06-02T10:00:00.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer cached",
					Fidelity: "resolved",
					Metadata: json.RawMessage(`{"stale":true,"cacheOnly":true}`),
				},
			},
		},
	})

	state = applyCatalogPatch(state, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:01.000Z",
		FinishedAt:    "2026-06-02T10:00:01.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer source",
					Fidelity: "partial",
					Source:   &store.SourceLoc{File: "/repo/prompts/writer.ts", Line: 12},
					Metadata: json.RawMessage(`{"stale":false,"ast":true}`),
				},
			},
		},
	})

	if len(state.Catalog.Definitions) != 1 {
		t.Fatalf("definitions = %+v, want one", state.Catalog.Definitions)
	}
	definition := state.Catalog.Definitions[0]
	if definition.Name != "writer source" || definition.Fidelity != "partial" {
		t.Fatalf("definition = %+v, want fresh AST fields", definition)
	}
	if definition.Source == nil || definition.Source.File != "/repo/prompts/writer.ts" {
		t.Fatalf("source = %+v, want AST source", definition.Source)
	}
	var metadata map[string]any
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("metadata unmarshal error = %v", err)
	}
	if metadata["cacheOnly"] != nil || metadata["ast"] != true || metadata["stale"] != false {
		t.Fatalf("metadata = %+v, want AST metadata without cached-only fields", metadata)
	}
}

func TestApplyCatalogPatchLetsSemanticEnrichStableDefinitions(t *testing.T) {
	state := applyCatalogPatch(emptyCatalogPatchState(), CatalogPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:00.000Z",
		FinishedAt:    "2026-06-02T10:00:00.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer source",
					Fidelity: "partial",
					Source:   &store.SourceLoc{File: "/repo/prompts/writer.ts", Line: 12},
					Metadata: json.RawMessage(`{"ast":true,"inputSchema":{"type":"object"}}`),
					SourceRefs: []store.ProjectSourceRef{
						{
							ID:       "prompt:writer:source:system:WRITER_SYSTEM",
							Role:     "system",
							Symbol:   "WRITER_SYSTEM",
							Source:   store.SourceLoc{File: "/repo/prompts/writer.ts", Line: 4},
							Fidelity: "partial",
						},
					},
				},
			},
		},
	})

	state = applyCatalogPatch(state, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "semantic",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:01.000Z",
		FinishedAt:    "2026-06-02T10:00:01.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer semantic",
					Fidelity: "resolved",
					Metadata: json.RawMessage(`{"semantic":true,"inputSchema":{"type":"object","additionalProperties":false}}`),
					SourceRefs: []store.ProjectSourceRef{
						{
							ID:       "prompt:writer:source:schema:input:WriterInput",
							Role:     "schema",
							Property: "input",
							Symbol:   "WriterInput",
							Source:   store.SourceLoc{File: "/repo/prompts/schema.ts", Line: 3},
							Fidelity: "resolved",
						},
					},
				},
			},
		},
	})

	if len(state.Catalog.Definitions) != 1 {
		t.Fatalf("definitions = %+v, want one", state.Catalog.Definitions)
	}
	definition := state.Catalog.Definitions[0]
	if definition.Name != "writer source" || definition.Fidelity != "partial" {
		t.Fatalf("definition = %+v, want AST-owned core fields", definition)
	}
	if len(definition.SourceRefs) != 2 {
		t.Fatalf("source refs = %+v, want AST and semantic refs", definition.SourceRefs)
	}
	var metadata map[string]any
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("metadata unmarshal error = %v", err)
	}
	if metadata["ast"] != true || metadata["semantic"] != true {
		t.Fatalf("metadata = %+v, want merged AST and semantic metadata", metadata)
	}
}

func TestApplyCatalogPatchUpgradesPartialRelationsByLogicalEdge(t *testing.T) {
	state := applyCatalogPatch(emptyCatalogPatchState(), CatalogPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:00.000Z",
		FinishedAt:    "2026-06-02T10:00:00.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Relations: []store.ProjectRelation{
				{ID: "relation:agent:Karyla:agent.uses_tool:tool:searchDocs", Type: "agent.uses_tool", From: "agent:Karyla", To: "tool:searchDocs", Fidelity: "partial"},
			},
		},
	})

	state = applyCatalogPatch(state, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "semantic",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:01.000Z",
		FinishedAt:    "2026-06-02T10:00:01.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Relations: []store.ProjectRelation{
				{ID: "relation:agent.uses_tool:agent:Karyla:tool:searchDocs", Type: "agent.uses_tool", From: "agent:Karyla", To: "tool:searchDocs", Fidelity: "resolved"},
			},
		},
	})

	if len(state.Catalog.Relations) != 1 {
		t.Fatalf("relations = %+v, want one logical edge", state.Catalog.Relations)
	}
	relation := state.Catalog.Relations[0]
	if relation.ID != "relation:agent.uses_tool:agent:Karyla:tool:searchDocs" || relation.Fidelity != "resolved" {
		t.Fatalf("relation = %+v, want resolved semantic relation", relation)
	}
}

func TestApplyCatalogPatchReplacesDiagnosticsOnlyForEmittingPhase(t *testing.T) {
	state := applyCatalogPatch(emptyCatalogPatchState(), CatalogPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:00.000Z",
		FinishedAt:    "2026-06-02T10:00:00.001Z",
		Status:        "partial",
		Facts: CatalogPatchFacts{
			Diagnostics: []store.CatalogDiagnostic{
				{ID: "diagnostic:ast:old", Severity: "warning", Code: "catalog.ast.old", Message: "old AST diagnostic"},
			},
		},
	})
	state = applyCatalogPatch(state, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "semantic",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:01.000Z",
		FinishedAt:    "2026-06-02T10:00:01.001Z",
		Status:        "degraded",
		Facts: CatalogPatchFacts{
			Diagnostics: []store.CatalogDiagnostic{
				{ID: "diagnostic:semantic:timeout", Severity: "info", Code: "catalog.semantic.timeout", Message: "semantic enrichment timed out"},
			},
		},
	})
	state = applyCatalogPatch(state, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:02.000Z",
		FinishedAt:    "2026-06-02T10:00:02.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Diagnostics: []store.CatalogDiagnostic{},
		},
	})

	if len(state.Catalog.Diagnostics) != 1 {
		t.Fatalf("diagnostics = %+v, want one semantic diagnostic", state.Catalog.Diagnostics)
	}
	if state.Catalog.Diagnostics[0].Code != "catalog.semantic.timeout" {
		t.Fatalf("diagnostics = %+v, want semantic diagnostic preserved", state.Catalog.Diagnostics)
	}
}

func TestServiceApplyCatalogPatchPublishesMergedReadModel(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.CatalogEvents().Subscribe(ctx)

	service.ApplyCatalogPatch(ctx, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "cache",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:00.000Z",
		FinishedAt:    "2026-06-02T10:00:00.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:writer", Kind: "prompt", Name: "writer cached", Fidelity: "resolved", Metadata: json.RawMessage(`{"cache":true}`)},
			},
		},
	})
	readCatalogEvent(t, events)

	service.ApplyCatalogPatch(ctx, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:01.000Z",
		FinishedAt:    "2026-06-02T10:00:01.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:writer", Kind: "prompt", Name: "writer source", Fidelity: "partial", Metadata: json.RawMessage(`{"ast":true}`)},
			},
		},
	})
	readCatalogEvent(t, events)

	service.ApplyCatalogPatch(ctx, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "semantic",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:02.000Z",
		FinishedAt:    "2026-06-02T10:00:02.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:writer", Kind: "prompt", Name: "writer semantic", Fidelity: "resolved", Metadata: json.RawMessage(`{"semantic":true}`)},
			},
		},
	})

	catalog := readCatalogEvent(t, events)
	definition := findDefinition(catalog.Definitions, "prompt:writer")
	if definition == nil {
		t.Fatal("prompt:writer missing")
	}
	if definition.Name != "writer source" || definition.Fidelity != "partial" {
		t.Fatalf("definition = %+v, want AST-owned core fields", definition)
	}
	var metadata map[string]any
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("metadata unmarshal error = %v", err)
	}
	if metadata["cache"] != nil || metadata["ast"] != true || metadata["semantic"] != true {
		t.Fatalf("metadata = %+v, want AST and semantic fields without stale cache", metadata)
	}
}

func TestServiceApplyCatalogPatchPublishesWithinTimeout(t *testing.T) {
	service := NewService(store.NewStore(), nil)
	defer service.Shutdown()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	events := service.CatalogEvents().Subscribe(ctx)

	service.ApplyCatalogPatch(ctx, CatalogPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:00.000Z",
		FinishedAt:    "2026-06-02T10:00:00.001Z",
		Status:        "ok",
		Facts: CatalogPatchFacts{
			Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "partial"}},
		},
	})

	select {
	case catalog := <-events:
		if findDefinition(catalog.Definitions, "prompt:writer") == nil {
			t.Fatalf("catalog = %+v, want patched definition", catalog)
		}
	case <-ctx.Done():
		t.Fatal("timed out waiting for patch catalog event")
	}
}

func TestCatalogPatchJSONUsesLowercaseIndexingField(t *testing.T) {
	payload, err := json.Marshal(CatalogPatch{
		SchemaVersion: 1,
		Phase:         "ast",
		Project:       store.ProjectIdentity{Root: "/repo"},
		StartedAt:     "2026-06-02T10:00:00.000Z",
		Status:        "ok",
		Indexing:      store.DefaultCatalogIndexingStatus(),
		Facts:         CatalogPatchFacts{},
	})
	if err != nil {
		t.Fatalf("marshal error = %v", err)
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("unmarshal error = %v", err)
	}
	if _, ok := decoded["indexing"]; !ok {
		t.Fatalf("payload = %s, want lowercase indexing field", payload)
	}
	if _, ok := decoded["Indexing"]; ok {
		t.Fatalf("payload = %s, want no exported Go field casing", payload)
	}
}
