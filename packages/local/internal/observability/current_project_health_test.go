package observability

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCompareCurrentProjectHealthPrimaryDefinition(t *testing.T) {
	health := CompareCurrentProjectHealth(
		[]DefinitionRef{{ID: "prompt:writer", Kind: "prompt", Role: "resolved-prompt"}},
		store.IndexData{
			IndexedAt: "2026-07-22T12:00:00Z",
			LintFindings: []store.IndexLintFinding{{
				ID: "lint:writer", RuleID: "prompt.missing_context", Severity: "warning",
				Title: "Writer has no context", Message: "Add authored context.",
				PrimaryDefinitionID: "prompt:writer",
				SuppressedBy: &store.IndexLintSuppressedBy{
					Source: &store.SourceLoc{File: "src/writer.ts", Line: 1}, Scope: "line",
				},
			}},
		},
	)

	if health == nil {
		t.Fatal("current project health is nil")
	}
	if health.Label != "current-project-health" || health.IndexedAt != "2026-07-22T12:00:00Z" {
		t.Fatalf("health identity = %#v", health)
	}
	if health.ActiveCount != 1 || health.SuppressedCount != 0 || len(health.Findings) != 1 {
		t.Fatalf("health counts/findings = %#v", health)
	}
	finding := health.Findings[0]
	if finding.ID != "lint:writer" || finding.RuleID != "prompt.missing_context" {
		t.Fatalf("finding = %#v", finding)
	}
	if finding.SuppressedBy != nil {
		t.Fatalf("active finding leaked suppression evidence: %#v", finding.SuppressedBy)
	}
	wantMatches := []CurrentProjectHealthMatch{{
		DefinitionID: "prompt:writer",
		Kind:         "prompt",
		Roles:        []string{"resolved-prompt"},
		MatchKinds:   []CurrentProjectHealthMatchKind{CurrentProjectHealthPrimary},
	}}
	if !reflect.DeepEqual(finding.MatchedDefinitions, wantMatches) {
		t.Fatalf("matched definitions = %#v, want %#v", finding.MatchedDefinitions, wantMatches)
	}
}

func TestCompareCurrentProjectHealthSanitizesSourcesAgainstProjectRoot(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "workspace", "project")
	findingColumn, directiveColumn := 7, 3
	health := CompareCurrentProjectHealth(
		[]DefinitionRef{{ID: "prompt:writer", Kind: "prompt", Role: "resolved-prompt"}},
		store.IndexData{
			Project:   &store.ProjectIdentity{Root: root},
			IndexedAt: "2026-07-22T12:00:00Z",
			LintFindings: []store.IndexLintFinding{
				{
					ID: "lint:relative", RuleID: "prompt.relative", Severity: "warning",
					PrimaryDefinitionID: "prompt:writer",
					Source:              &store.SourceLoc{File: filepath.Join(root, "src", "writer.ts"), Line: 9, Column: &findingColumn},
				},
				{
					ID: "lint:suppressed", RuleID: "prompt.suppressed", Severity: "warning",
					PrimaryDefinitionID: "prompt:writer", Suppressed: true,
					Source: &store.SourceLoc{File: "src/already-relative.ts", Line: 4},
					SuppressedBy: &store.IndexLintSuppressedBy{
						Source: &store.SourceLoc{File: filepath.Join(root, "src", "writer.ts"), Line: 8, Column: &directiveColumn},
						Scope:  "next-line",
					},
				},
			},
		},
	)

	if health == nil || len(health.Findings) != 2 {
		t.Fatalf("health = %#v", health)
	}
	byID := map[string]CurrentProjectHealthFinding{}
	for _, finding := range health.Findings {
		byID[finding.ID] = finding
	}
	if got := byID["lint:relative"].Source; got == nil || got.File != "src/writer.ts" {
		t.Fatalf("finding source = %#v", got)
	}
	if got := byID["lint:suppressed"].Source; got == nil || got.File != "src/already-relative.ts" {
		t.Fatalf("already-relative source = %#v", got)
	}
	if got := byID["lint:suppressed"].SuppressedBy; got == nil || got.Source == nil || got.Source.File != "src/writer.ts" {
		t.Fatalf("directive source = %#v", got)
	}
}

func TestCompareCurrentProjectHealthFailsClosedForOutsideRootSources(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "workspace", "project")
	health := CompareCurrentProjectHealth(
		[]DefinitionRef{{ID: "prompt:writer", Kind: "prompt", Role: "resolved-prompt"}},
		store.IndexData{
			Project:   &store.ProjectIdentity{Root: root},
			IndexedAt: "2026-07-22T12:00:00Z",
			LintFindings: []store.IndexLintFinding{
				{
					ID: "lint:active", RuleID: "prompt.active", Severity: "warning",
					PrimaryDefinitionID: "prompt:writer",
					Source:              &store.SourceLoc{File: filepath.Join(string(filepath.Separator), "private", "active.ts"), Line: 1},
				},
				{
					ID: "lint:suppressed", RuleID: "prompt.suppressed", Severity: "warning",
					PrimaryDefinitionID: "prompt:writer", Suppressed: true,
					SuppressedBy: &store.IndexLintSuppressedBy{
						Source: &store.SourceLoc{File: "../private/directive.ts", Line: 1}, Scope: "file",
					},
				},
			},
		},
	)

	if health == nil || health.ActiveCount != 1 || health.SuppressedCount != 0 || len(health.Findings) != 1 {
		t.Fatalf("fail-closed health = %#v", health)
	}
	if health.Findings[0].Source != nil {
		t.Fatalf("outside active source leaked: %#v", health.Findings[0].Source)
	}
}

func TestCompareCurrentProjectHealthMergesEveryDefinitionReach(t *testing.T) {
	health := CompareCurrentProjectHealth(
		[]DefinitionRef{
			{ID: "prompt:a", Kind: "prompt", Role: "used-prompt"},
			{ID: "prompt:a", Kind: "prompt", Role: "resolved-prompt"},
			{ID: "prompt:a", Kind: "prompt", Role: "used-prompt"},
			{ID: "tool:b", Kind: "tool", Role: "invoked-tool"},
			{ID: "context:c", Kind: "context", Role: "resolved-context"},
		},
		store.IndexData{
			IndexedAt: "2026-07-22T12:00:00Z",
			LintFindings: []store.IndexLintFinding{
				{
					ID: "lint:reaches", RuleID: "graph.reaches", Severity: "warning",
					PrimaryDefinitionID:     "prompt:a",
					RelatedDefinitionIDs:    []string{"tool:b", "prompt:a"},
					AffectedDefinitionIDs:   []string{"context:c", "tool:b"},
					PropagatedDefinitionIDs: []string{"context:c"},
				},
				{ID: "lint:unrelated", PrimaryDefinitionID: "tool:other"},
				{ID: "lint:no-definition"},
			},
		},
	)

	if health == nil || len(health.Findings) != 1 {
		t.Fatalf("health = %#v", health)
	}
	want := []CurrentProjectHealthMatch{
		{
			DefinitionID: "context:c", Kind: "context",
			Roles:      []string{"resolved-context"},
			MatchKinds: []CurrentProjectHealthMatchKind{CurrentProjectHealthAffected, CurrentProjectHealthPropagated},
		},
		{
			DefinitionID: "prompt:a", Kind: "prompt",
			Roles:      []string{"resolved-prompt", "used-prompt"},
			MatchKinds: []CurrentProjectHealthMatchKind{CurrentProjectHealthPrimary, CurrentProjectHealthRelated},
		},
		{
			DefinitionID: "tool:b", Kind: "tool",
			Roles:      []string{"invoked-tool"},
			MatchKinds: []CurrentProjectHealthMatchKind{CurrentProjectHealthRelated, CurrentProjectHealthAffected},
		},
	}
	if !reflect.DeepEqual(health.Findings[0].MatchedDefinitions, want) {
		t.Fatalf("matches = %#v, want %#v", health.Findings[0].MatchedDefinitions, want)
	}
}

func TestCompareCurrentProjectHealthPreservesSuppressionEvidenceAndSortsFindings(t *testing.T) {
	findingColumn, directiveColumn, fileColumn := 2, 4, 1
	findingSource := &store.SourceLoc{File: "src/writer.ts", Line: 9, Column: &findingColumn}
	directiveSource := &store.SourceLoc{File: "src/writer.ts", Line: 8, Column: &directiveColumn}
	health := CompareCurrentProjectHealth(
		[]DefinitionRef{{ID: "prompt:writer", Kind: "prompt", Role: "resolved-prompt"}},
		store.IndexData{
			IndexedAt: "2026-07-22T12:00:00Z",
			LintFindings: []store.IndexLintFinding{
				{ID: "lint:info", RuleID: "z.info", Severity: "info", PrimaryDefinitionID: "prompt:writer"},
				{
					ID: "lint:suppressed", RuleID: "a.warning", Severity: "warning",
					Title: "Suppressed warning", Message: "Current warning.", Source: findingSource,
					PrimaryDefinitionID: "prompt:writer", Suppressed: true,
					SuppressedBy: &store.IndexLintSuppressedBy{
						Source: directiveSource, Scope: "next-line", Reason: "validated externally",
					},
				},
				{
					ID: "lint:reasonless", RuleID: "b.error", Severity: "error",
					PrimaryDefinitionID: "prompt:writer", Suppressed: true,
					SuppressedBy: &store.IndexLintSuppressedBy{
						Source: &store.SourceLoc{File: "src/writer.ts", Line: 1, Column: &fileColumn}, Scope: "file",
					},
				},
			},
		},
	)

	if health == nil || health.ActiveCount != 1 || health.SuppressedCount != 2 {
		t.Fatalf("health counts = %#v", health)
	}
	gotIDs := []string{health.Findings[0].ID, health.Findings[1].ID, health.Findings[2].ID}
	wantIDs := []string{"lint:reasonless", "lint:suppressed", "lint:info"}
	if !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Fatalf("finding order = %v, want %v", gotIDs, wantIDs)
	}
	suppressed := health.Findings[1]
	if suppressed.Source == nil || *suppressed.Source != *findingSource {
		t.Fatalf("finding source = %#v", suppressed.Source)
	}
	if suppressed.SuppressedBy == nil || suppressed.SuppressedBy.Source == nil ||
		*suppressed.SuppressedBy.Source != *directiveSource ||
		suppressed.SuppressedBy.Scope != "next-line" ||
		suppressed.SuppressedBy.Reason != "validated externally" {
		t.Fatalf("suppression evidence = %#v", suppressed.SuppressedBy)
	}
	reasonless := health.Findings[0]
	if reasonless.SuppressedBy == nil || reasonless.SuppressedBy.Scope != "file" || reasonless.SuppressedBy.Reason != "" {
		t.Fatalf("reasonless suppression evidence = %#v", reasonless.SuppressedBy)
	}
}

func TestCompareCurrentProjectHealthDistinguishesAbsentAndEmptyIndexContext(t *testing.T) {
	refs := []DefinitionRef{{ID: "prompt:writer", Kind: "prompt", Role: "resolved-prompt"}}
	if health := CompareCurrentProjectHealth(refs, store.IndexData{}); health != nil {
		t.Fatalf("absent index health = %#v, want nil", health)
	}

	health := CompareCurrentProjectHealth(refs, store.IndexData{
		IndexedAt: "2026-07-22T12:00:00Z",
		LintFindings: []store.IndexLintFinding{{
			ID: "lint:other", PrimaryDefinitionID: "prompt:other",
		}},
	})
	if health == nil {
		t.Fatal("materialized empty health is nil")
	}
	if health.ActiveCount != 0 || health.SuppressedCount != 0 || health.Findings == nil || len(health.Findings) != 0 {
		t.Fatalf("materialized empty health = %#v", health)
	}
}
