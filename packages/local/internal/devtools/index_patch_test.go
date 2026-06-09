package devtools

import (
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
