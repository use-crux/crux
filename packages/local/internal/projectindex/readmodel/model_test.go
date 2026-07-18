package readmodel

import (
	"os"
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

func TestApplyIndexLintPolicyAcceptsScopedExtensionRuleSuppressions(t *testing.T) {
	root := t.TempDir()
	sourceFile := filepath.Join(root, "workflow.ts")
	if err := os.WriteFile(sourceFile, []byte("// crux-lint-disable-next-line @acme/rules/require-owner -- external owner registry\nworkflow();\n"), 0644); err != nil {
		t.Fatal(err)
	}

	index := store.IndexData{
		Sources: []store.IndexSourceFile{{File: sourceFile, Status: "indexed"}},
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
			Source:     &store.SourceLoc{File: sourceFile, Line: 2},
			Evidence:   []store.IndexLintEvidence{},
			Fixes:      []store.IndexLintFix{},
		}},
	}

	applyIndexLintPolicy(&index)

	if len(index.LintFindings) != 0 {
		t.Fatalf("lint findings = %+v, want suppressed extension finding", index.LintFindings)
	}
}
