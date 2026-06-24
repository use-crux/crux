package model

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestMergeRuntimeSnapshotEnrichesCurrentIndex(t *testing.T) {
	source := &store.SourceLoc{File: "src/writer.ts", Line: 12}
	currentGraph := &store.ProjectIndexSourceGraph{ProducedBy: "ast"}
	incomingGraph := &store.ProjectIndexSourceGraph{ProducedBy: "runtime"}
	indexing := &store.ProjectIndexingStatus{Status: "ready"}
	current := store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: "/repo", Name: "project", ConfigFile: "/repo/crux.config.ts"},
		IndexedAt:     "2026-06-01T00:00:00Z",
		Prompts:       []store.PromptMeta{{ID: "writer", Description: "indexed"}},
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "partial",
				Status:   "active",
				Source:   source,
				Metadata: mustMarshalJSON(map[string]any{
					"inputSchema": map[string]any{"type": "object"},
				}),
			},
		},
		Relations: []store.ProjectRelation{
			{ID: "relation:old", Type: "prompt.uses_context", From: "prompt:writer", To: "context:brand", Fidelity: "partial"},
			{ID: "relation:older", Type: "prompt.uses_context", From: "prompt:writer", To: "context:brand", Fidelity: "partial"},
		},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:static", Severity: "warning", Code: "index.static_partial", Message: "static"},
			{ID: "diagnostic:index:source-only", Severity: "warning", Code: "index.source_only", Message: "source only"},
		},
		Sources:      []store.IndexSourceFile{{File: "src/writer.ts", Status: "indexed"}},
		LintFindings: []store.IndexLintFinding{{ID: "lint:static", RuleID: "static", Severity: "warning"}},
		SourceGraph:  currentGraph,
	}
	incoming := store.IndexData{
		SchemaVersion: 2,
		Project:       &store.ProjectIdentity{Root: "/other", Name: "other"},
		Prompts:       []store.PromptMeta{{ID: "runtime", Description: "runtime"}},
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Status:   "active",
				Metadata: mustMarshalJSON(map[string]any{"hasOutput": false}),
			},
			{ID: "prompt:runtime", Kind: "prompt", Name: "runtime", Fidelity: "resolved", Status: "active"},
		},
		Relations: []store.ProjectRelation{
			{ID: "relation:runtime", Type: "prompt.uses_context", From: "prompt:writer", To: "context:brand", Fidelity: "resolved"},
		},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:index:source-only", Severity: "warning", Code: "index.source_only", Message: "source only"},
			{ID: "diagnostic:runtime", Severity: "info", Code: "index.runtime", Message: "runtime"},
		},
		Sources:      []store.IndexSourceFile{{File: "src/runtime.ts", Status: "indexed"}},
		LintFindings: []store.IndexLintFinding{{ID: "lint:runtime", RuleID: "runtime", Severity: "info"}},
		Lint:         &store.IndexLintConfig{Profile: "runtime"},
		Indexing:     indexing,
		SourceGraph:  incomingGraph,
	}

	merged := MergeRuntimeSnapshot(current, incoming)

	if merged.Project != current.Project {
		t.Fatalf("project = %+v, want current project identity preserved", merged.Project)
	}
	if merged.SchemaVersion != 2 || merged.IndexedAt != current.IndexedAt {
		t.Fatalf("snapshot metadata = version %d indexedAt %q, want incoming schema and current indexedAt", merged.SchemaVersion, merged.IndexedAt)
	}
	if merged.Lint == nil || merged.Lint.Profile != "runtime" {
		t.Fatalf("lint config = %+v, want incoming lint config", merged.Lint)
	}
	if merged.Indexing != indexing || merged.SourceGraph != incomingGraph {
		t.Fatalf("runtime-owned state not applied: indexing=%+v sourceGraph=%+v", merged.Indexing, merged.SourceGraph)
	}
	if len(merged.Prompts) != 2 {
		t.Fatalf("prompts = %+v, want current and incoming prompts", merged.Prompts)
	}
	definition := findTestDefinition(merged.Definitions, "prompt:writer")
	if definition == nil {
		t.Fatalf("definitions = %+v, want merged writer definition", merged.Definitions)
	}
	if definition.Fidelity != "resolved" || definition.Source == nil || definition.Source.File != source.File {
		t.Fatalf("definition = %+v, want resolved runtime definition with indexed source preserved", definition)
	}
	var metadata map[string]any
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("metadata unmarshal error = %v", err)
	}
	if metadata["inputSchema"] == nil || metadata["hasOutput"] != false {
		t.Fatalf("metadata = %+v, want current and incoming metadata merged", metadata)
	}
	if findTestDefinition(merged.Definitions, "prompt:runtime") == nil {
		t.Fatalf("definitions = %+v, want runtime definition", merged.Definitions)
	}
	if len(merged.Relations) != 1 || merged.Relations[0].ID != "relation:runtime" || merged.Relations[0].Fidelity != "resolved" {
		t.Fatalf("relations = %+v, want one resolved logical relation", merged.Relations)
	}
	if HasSourceOnlyDiagnostic(merged.Diagnostics) {
		t.Fatalf("diagnostics = %+v, want source-only marker filtered", merged.Diagnostics)
	}
	if findTestDiagnostic(merged.Diagnostics, "diagnostic:static") == nil || findTestDiagnostic(merged.Diagnostics, "diagnostic:runtime") == nil {
		t.Fatalf("diagnostics = %+v, want static and runtime diagnostics", merged.Diagnostics)
	}
	if findTestSource(merged.Sources, "src/writer.ts") == nil || findTestSource(merged.Sources, "src/runtime.ts") == nil {
		t.Fatalf("sources = %+v, want current and incoming source rows", merged.Sources)
	}
	if findTestLintFinding(merged.LintFindings, "lint:static") == nil || findTestLintFinding(merged.LintFindings, "lint:runtime") == nil {
		t.Fatalf("lint findings = %+v, want current and incoming findings", merged.LintFindings)
	}
}

func TestMergeRuntimeSnapshotNormalizesEmptyCurrent(t *testing.T) {
	merged := MergeRuntimeSnapshot(store.IndexData{}, store.IndexData{
		SchemaVersion: 1,
		Prompts: []store.PromptMeta{
			{ID: "writer", Description: "old"},
			{ID: "writer", Description: "new"},
		},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "partial", Status: "active", Description: "indexed"},
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved", Status: "active"},
		},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:index:source-only", Severity: "warning", Code: "index.source_only", Message: "source only"},
			{ID: "diagnostic:runtime", Severity: "info", Code: "index.runtime", Message: "runtime"},
		},
	})

	if len(merged.Prompts) != 1 || merged.Prompts[0].Description != "new" {
		t.Fatalf("prompts = %+v, want normalized latest prompt", merged.Prompts)
	}
	definition := findTestDefinition(merged.Definitions, "prompt:writer")
	if definition == nil || definition.Fidelity != "resolved" || definition.Description != "indexed" {
		t.Fatalf("definitions = %+v, want merged resolved definition with existing description", merged.Definitions)
	}
	if HasSourceOnlyDiagnostic(merged.Diagnostics) || findTestDiagnostic(merged.Diagnostics, "diagnostic:runtime") == nil {
		t.Fatalf("diagnostics = %+v, want source-only marker removed and runtime diagnostic kept", merged.Diagnostics)
	}
}

func TestFilterRuntimeDiagnosticsRemovesOnlySourceOnlyMarkers(t *testing.T) {
	diagnostics := FilterRuntimeDiagnostics([]store.IndexDiagnostic{
		{ID: "diagnostic:index:source-only", Code: "index.source_only"},
		{ID: "diagnostic:other", Code: "index.other"},
	})

	if len(diagnostics) != 1 || diagnostics[0].ID != "diagnostic:other" {
		t.Fatalf("diagnostics = %+v, want only non-source-only diagnostics", diagnostics)
	}
}
