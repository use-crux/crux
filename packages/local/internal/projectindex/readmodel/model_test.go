package readmodel

import (
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type snapshotSource struct{ index store.IndexData }

func (s snapshotSource) Snapshot() store.IndexData { return s.index }

func definitionByID(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for index := range definitions {
		if definitions[index].ID == id {
			return &definitions[index]
		}
	}
	return nil
}

func TestModelIndexPreservesMaterializedSuppressedFinding(t *testing.T) {
	missingSource := filepath.Join(t.TempDir(), "missing-workflow.ts")
	index := store.IndexData{
		Sources: []store.IndexSourceFile{{File: missingSource, Status: "indexed"}},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "unknown", Code: "index.lint_unknown_suppression_rule"},
			{ID: "unused", Code: "index.lint_unused_suppression"},
		},
		LintFindings: []store.IndexLintFinding{{
			ID:         "lint:@acme/rules/require-owner:workflow",
			Severity:   "warning",
			RuleID:     "@acme/rules/require-owner",
			Category:   "quality",
			Maturity:   "experimental",
			Confidence: "medium",
			Profiles:   []string{"recommended"},
			Title:      "Require owner",
			Message:    "Workflow is missing owner metadata.",
			Source:     &store.SourceLoc{File: missingSource, Line: 2},
			Evidence:   []store.IndexLintEvidence{},
			Fixes:      []store.IndexLintFix{},
			Suppressed: true,
			SuppressedBy: &store.IndexLintSuppressedBy{
				Source: &store.SourceLoc{File: missingSource, Line: 1},
				Scope:  "next-line",
				Reason: "external owner registry",
			},
		}},
	}

	got := New(snapshotSource{index: index}).Index()

	if len(got.LintFindings) != 1 {
		t.Fatalf("lint findings = %+v, want materialized suppressed finding preserved", got.LintFindings)
	}
	if got.LintFindings[0].SuppressedBy == nil || got.LintFindings[0].SuppressedBy.Scope != "next-line" {
		t.Fatalf("suppressedBy = %+v, want complete metadata", got.LintFindings[0].SuppressedBy)
	}
	if len(got.Diagnostics) != 2 {
		t.Fatalf("diagnostics = %+v, want materialized diagnostics preserved", got.Diagnostics)
	}
}
