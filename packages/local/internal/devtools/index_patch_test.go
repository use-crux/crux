package devtools

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestApplyIndexPatchExactFileInvalidationRemovesOwnedFacts(t *testing.T) {
	state := applyIndexPatch(emptyIndexPatchState(), IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				testDefinition("definition:a", "src/a.ts"),
				testDefinition("definition:b", "src/b.ts"),
			},
			Relations: []store.ProjectRelation{
				{ID: "relation:a:b", Type: "uses", From: "definition:a", To: "definition:b", Fidelity: "resolved", Source: &store.SourceLoc{File: "src/a.ts", Line: 1}},
				{ID: "relation:b:c", Type: "uses", From: "definition:b", To: "definition:c", Fidelity: "resolved", Source: &store.SourceLoc{File: "src/b.ts", Line: 1}},
			},
			Diagnostics: []store.IndexDiagnostic{
				{ID: "diagnostic:a", Severity: "error", Code: "a", Message: "a", Source: &store.SourceLoc{File: "src/a.ts", Line: 1}},
				{ID: "diagnostic:b", Severity: "warning", Code: "b", Message: "b", Source: &store.SourceLoc{File: "src/b.ts", Line: 1}},
			},
			LintFindings: []store.IndexLintFinding{
				{ID: "finding:a", RuleID: "rule", PrimaryDefinitionID: "definition:a", Severity: "warning"},
				{ID: "finding:b", RuleID: "rule", PrimaryDefinitionID: "definition:b", Severity: "warning"},
			},
			RuleDescriptors: []store.IndexRuleDescriptor{
				{ID: "rule", Source: "builtin", Title: "Rule", Description: "Rule description."},
			},
			Sources: []store.IndexSourceFile{
				{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"definition:a"}, Diagnostics: []string{"diagnostic:a"}},
				{File: "src/b.ts", Status: "active", DefinitionIDs: []string{"definition:b"}, Diagnostics: []string{"diagnostic:b"}},
			},
		},
	})

	next := applyIndexPatch(state, IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{Files: []string{"src/a.ts"}},
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				testDefinition("definition:a2", "src/a.ts"),
			},
			Diagnostics: []store.IndexDiagnostic{
				{ID: "diagnostic:a2", Severity: "info", Code: "a2", Message: "a2", Source: &store.SourceLoc{File: "src/a.ts", Line: 2}},
			},
			Sources: []store.IndexSourceFile{
				{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"definition:a2"}, Diagnostics: []string{"diagnostic:a2"}},
			},
		},
	})

	if findTestDefinition(next.Index.Definitions, "definition:a") != nil {
		t.Fatalf("stale definition from invalidated file survived: %+v", next.Index.Definitions)
	}
	if findTestDefinition(next.Index.Definitions, "definition:a2") == nil {
		t.Fatalf("replacement definition missing: %+v", next.Index.Definitions)
	}
	if findTestDefinition(next.Index.Definitions, "definition:b") == nil {
		t.Fatalf("unrelated definition removed: %+v", next.Index.Definitions)
	}
	if findTestRelation(next.Index.Relations, "relation:a:b") != nil {
		t.Fatalf("stale relation from invalidated file survived: %+v", next.Index.Relations)
	}
	if findTestRelation(next.Index.Relations, "relation:b:c") == nil {
		t.Fatalf("unrelated relation removed: %+v", next.Index.Relations)
	}
	if findTestDiagnostic(next.Index.Diagnostics, "diagnostic:a") != nil {
		t.Fatalf("stale diagnostic from invalidated file survived: %+v", next.Index.Diagnostics)
	}
	if findTestDiagnostic(next.Index.Diagnostics, "diagnostic:a2") == nil {
		t.Fatalf("replacement diagnostic missing: %+v", next.Index.Diagnostics)
	}
	if findTestDiagnostic(next.Index.Diagnostics, "diagnostic:b") == nil {
		t.Fatalf("unrelated diagnostic removed: %+v", next.Index.Diagnostics)
	}
	if findTestLintFinding(next.Index.LintFindings, "finding:a") != nil {
		t.Fatalf("definition-owned lint finding survived invalidation: %+v", next.Index.LintFindings)
	}
	if findTestLintFinding(next.Index.LintFindings, "finding:b") == nil {
		t.Fatalf("unrelated lint finding removed: %+v", next.Index.LintFindings)
	}
	if len(next.Index.RuleDescriptors) != 1 || next.Index.RuleDescriptors[0].ID != "rule" {
		t.Fatalf("rule descriptors were not preserved: %+v", next.Index.RuleDescriptors)
	}
	if findTestSource(next.Index.Sources, "src/a.ts") == nil {
		t.Fatalf("replacement source row missing: %+v", next.Index.Sources)
	}
	if findTestSource(next.Index.Sources, "src/b.ts") == nil {
		t.Fatalf("unrelated source row removed: %+v", next.Index.Sources)
	}
}

func TestMergeIndexPatchesUsesExistingPatchMergeRules(t *testing.T) {
	merged, err := MergeIndexPatches([]IndexPatch{
		{
			SchemaVersion: 1,
			Phase:         indexPatchPhaseAST,
			Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
			StartedAt:     "2026-01-01T00:00:00Z",
			FinishedAt:    "2026-01-01T00:00:01Z",
			Status:        "ok",
			Invalidates:   &IndexPatchInvalidation{All: true},
			Facts: IndexPatchFacts{
				Definitions: []store.ProjectDefinition{
					testDefinition("definition:native", "src/a.ts"),
				},
				Sources: []store.IndexSourceFile{
					{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"definition:native"}},
				},
			},
		},
		{
			SchemaVersion: 1,
			Phase:         indexPatchPhaseAST,
			Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
			StartedAt:     "2026-01-01T00:00:01Z",
			FinishedAt:    "2026-01-01T00:00:02Z",
			Status:        "partial",
			Facts: IndexPatchFacts{
				Definitions: []store.ProjectDefinition{
					testDefinition("definition:typescript", "src/a.ts"),
				},
				Sources: []store.IndexSourceFile{
					{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"definition:typescript"}},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("MergeIndexPatches() error = %v", err)
	}
	if merged.Status != "partial" {
		t.Fatalf("merged status = %q, want partial", merged.Status)
	}
	if merged.StartedAt != "2026-01-01T00:00:00Z" || merged.FinishedAt != "2026-01-01T00:00:02Z" {
		t.Fatalf("merged times = %s/%s", merged.StartedAt, merged.FinishedAt)
	}
	if findTestDefinition(merged.Facts.Definitions, "definition:native") == nil {
		t.Fatalf("native lane definition missing: %+v", merged.Facts.Definitions)
	}
	if findTestDefinition(merged.Facts.Definitions, "definition:typescript") == nil {
		t.Fatalf("TypeScript lane definition missing: %+v", merged.Facts.Definitions)
	}
	if len(merged.Facts.Sources) != 1 || len(merged.Facts.Sources[0].DefinitionIDs) != 2 {
		t.Fatalf("merged source row = %+v, want one row with two definitions", merged.Facts.Sources)
	}
}

func TestApplyIndexPatchMergesSourceRowsByUnion(t *testing.T) {
	state := applyIndexPatch(emptyIndexPatchState(), IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Sources: []store.IndexSourceFile{
				{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"definition:a"}, Dependencies: []string{"src/b.ts"}, Diagnostics: []string{"diagnostic:a"}},
			},
		},
	})

	next := applyIndexPatch(state, IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Sources: []store.IndexSourceFile{
				{File: "src/a.ts", Status: "active", DefinitionIDs: []string{"definition:schema"}, Dependents: []string{"src/c.ts"}, Diagnostics: []string{"diagnostic:semantic"}},
			},
		},
	})

	source := findTestSource(next.Index.Sources, "src/a.ts")
	if source == nil {
		t.Fatal("merged source row missing")
	}
	assertStringSet(t, source.DefinitionIDs, []string{"definition:a", "definition:schema"})
	assertStringSet(t, source.Dependencies, []string{"src/b.ts"})
	assertStringSet(t, source.Dependents, []string{"src/c.ts"})
	assertStringSet(t, source.Diagnostics, []string{"diagnostic:a", "diagnostic:semantic"})
}

func TestApplyIndexPatchFinalizesInjectionInputContractsAfterSemanticPatch(t *testing.T) {
	state := applyIndexPatch(emptyIndexPatchState(), IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer",
					Fidelity: "resolved",
					Status:   "active",
					Metadata: mustMarshalJSON(map[string]any{
						"inputSchema": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"topic": map[string]any{"type": "string"},
							},
							"required": []any{"topic"},
						},
						"facts": map[string]any{
							"useEntries": []any{
								map[string]any{
									"variable":       "brandContext",
									"conditionality": "always",
									"via":            "direct",
								},
							},
						},
					}),
				},
				{
					ID:       "context:brandContext",
					Kind:     "context",
					Name:     "brandContext",
					Fidelity: "partial",
					Status:   "active",
				},
			},
		},
	})

	next := applyIndexPatch(state, IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "context:brandContext",
					Kind:     "context",
					Name:     "brandContext",
					Fidelity: "resolved",
					Status:   "active",
					Metadata: mustMarshalJSON(map[string]any{
						"inputSchema": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"locale": map[string]any{"type": "string"},
							},
							"required": []any{"locale"},
						},
					}),
				},
			},
			Relations: []store.ProjectRelation{
				{ID: "relation:writer:brand", Type: "prompt.uses_context", From: "prompt:writer", To: "context:brandContext", Fidelity: "resolved"},
			},
		},
	})

	prompt := findTestDefinition(next.Index.Definitions, "prompt:writer")
	if prompt == nil {
		t.Fatal("prompt definition missing")
	}
	contract := definitionContract(t, *prompt)
	expanded := contractObject(t, contract, "expandedInputSchema")
	properties := objectField(t, expanded, "properties")
	if _, ok := properties["topic"]; !ok {
		t.Fatalf("expanded properties = %#v, want authored topic", properties)
	}
	if _, ok := properties["locale"]; !ok {
		t.Fatalf("expanded properties = %#v, want injected locale", properties)
	}
	assertStringSet(t, stringsFromAnyList(expanded["required"]), []string{"topic", "locale"})
	contributions := anyListField(t, contract, "inputContributions")
	if len(contributions) != 1 {
		t.Fatalf("inputContributions len = %d, want 1: %#v", len(contributions), contributions)
	}
	contribution, ok := contributions[0].(map[string]any)
	if !ok {
		t.Fatalf("input contribution = %#v, want object", contributions[0])
	}
	if contribution["field"] != "locale" || contribution["sourceDefinitionId"] != "context:brandContext" {
		t.Fatalf("input contribution = %#v, want locale from context:brandContext", contribution)
	}
}

func TestApplyIndexPatchFinalizerRemovesStaleInjectionInputContracts(t *testing.T) {
	state := applyIndexPatch(emptyIndexPatchState(), IndexPatch{
		SchemaVersion: 1,
		Phase:         indexPatchPhaseAST,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "project"},
		Status:        "ok",
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				{
					ID:       "prompt:writer",
					Kind:     "prompt",
					Name:     "writer",
					Fidelity: "resolved",
					Status:   "active",
					Metadata: mustMarshalJSON(map[string]any{
						"inputSchema": map[string]any{
							"type":       "object",
							"properties": map[string]any{},
						},
						"intelligence": map[string]any{
							"contract": map[string]any{
								"expandedInputSchema": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"stale": map[string]any{"type": "string"},
									},
								},
								"inputContributions": []any{
									map[string]any{"field": "stale", "sourceDefinitionId": "context:stale"},
								},
							},
						},
					}),
				},
			},
		},
	})

	prompt := findTestDefinition(state.Index.Definitions, "prompt:writer")
	if prompt == nil {
		t.Fatal("prompt definition missing")
	}
	contract := definitionContract(t, *prompt)
	if _, ok := contract["expandedInputSchema"]; ok {
		t.Fatalf("expandedInputSchema survived without contributions: %#v", contract)
	}
	if _, ok := contract["inputContributions"]; ok {
		t.Fatalf("inputContributions survived without contributions: %#v", contract)
	}
}

func testDefinition(id string, file string) store.ProjectDefinition {
	return store.ProjectDefinition{
		ID:       id,
		Kind:     "prompt",
		Name:     id,
		Fidelity: "resolved",
		Status:   "active",
		Source:   &store.SourceLoc{File: file, Line: 1},
	}
}

func definitionContract(t *testing.T, definition store.ProjectDefinition) map[string]any {
	t.Helper()
	var metadata map[string]any
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("unmarshal metadata: %v", err)
	}
	intelligence := objectField(t, metadata, "intelligence")
	return objectField(t, intelligence, "contract")
}

func contractObject(t *testing.T, contract map[string]any, key string) map[string]any {
	t.Helper()
	return objectField(t, contract, key)
}

func objectField(t *testing.T, object map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := object[key].(map[string]any)
	if !ok {
		t.Fatalf("%s = %#v, want object", key, object[key])
	}
	return value
}

func anyListField(t *testing.T, object map[string]any, key string) []any {
	t.Helper()
	value, ok := object[key].([]any)
	if !ok {
		t.Fatalf("%s = %#v, want list", key, object[key])
	}
	return value
}

func stringsFromAnyList(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}

func findTestDefinition(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}

func findTestRelation(relations []store.ProjectRelation, id string) *store.ProjectRelation {
	for i := range relations {
		if relations[i].ID == id {
			return &relations[i]
		}
	}
	return nil
}

func findTestDiagnostic(diagnostics []store.IndexDiagnostic, id string) *store.IndexDiagnostic {
	for i := range diagnostics {
		if diagnostics[i].ID == id {
			return &diagnostics[i]
		}
	}
	return nil
}

func findTestLintFinding(findings []store.IndexLintFinding, id string) *store.IndexLintFinding {
	for i := range findings {
		if findings[i].ID == id {
			return &findings[i]
		}
	}
	return nil
}

func findTestSource(sources []store.IndexSourceFile, file string) *store.IndexSourceFile {
	for i := range sources {
		if sources[i].File == file {
			return &sources[i]
		}
	}
	return nil
}

func assertStringSet(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("values = %v, want %v", actual, expected)
	}
	seen := map[string]bool{}
	for _, value := range actual {
		seen[value] = true
	}
	for _, value := range expected {
		if !seen[value] {
			t.Fatalf("values = %v, want %v", actual, expected)
		}
	}
}
