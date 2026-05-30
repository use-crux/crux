package commands

import (
	"testing"

	"github.com/use-crux/crux/packages/cli/internal/api"
)

func TestSelectLintFindingsFiltersByProfileAndSuppression(t *testing.T) {
	findings := []api.CatalogLintFinding{
		{ID: "recommended", Severity: "warning", Profiles: []string{"recommended", "strict"}},
		{ID: "strict", Severity: "info", Profiles: []string{"strict"}},
		{ID: "suppressed", Severity: "warning", Profiles: []string{"recommended"}, Suppressed: true},
		{ID: "legacy", Severity: "info"},
	}

	selected, err := selectLintFindings(findings, lintSelectionOptions{profile: "recommended"})
	if err != nil {
		t.Fatal(err)
	}
	if got := lintFindingIDs(selected); len(got) != 2 || got[0] != "recommended" || got[1] != "legacy" {
		t.Fatalf("recommended selected = %#v", got)
	}

	selected, err = selectLintFindings(findings, lintSelectionOptions{profile: "strict", includeSuppressed: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := lintFindingIDs(selected); len(got) != 3 || got[0] != "recommended" || got[1] != "strict" || got[2] != "legacy" {
		t.Fatalf("strict selected = %#v", got)
	}

	selected, err = selectLintFindings(findings, lintSelectionOptions{profile: "off", includeSuppressed: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 0 {
		t.Fatalf("off selected = %#v, want empty", selected)
	}
}

func TestSelectLintFindingsRejectsUnknownProfile(t *testing.T) {
	_, err := selectLintFindings(nil, lintSelectionOptions{profile: "surprise"})
	if err == nil {
		t.Fatal("expected unknown profile error")
	}
}

func TestLintGateFailuresIsExplicitAndSeverityThresholded(t *testing.T) {
	findings := []api.CatalogLintFinding{
		{ID: "info", Severity: "info"},
		{ID: "warning", Severity: "warning"},
		{ID: "error", Severity: "error"},
	}

	failures, err := lintGateFailures(findings, "")
	if err != nil {
		t.Fatal(err)
	}
	if failures != nil {
		t.Fatalf("default gate failures = %#v, want nil", failures)
	}

	failures, err = lintGateFailures(findings, "warning")
	if err != nil {
		t.Fatal(err)
	}
	if got := lintFindingIDs(failures); len(got) != 2 || got[0] != "warning" || got[1] != "error" {
		t.Fatalf("warning gate failures = %#v", got)
	}

	failures, err = lintGateFailures(findings, "error")
	if err != nil {
		t.Fatal(err)
	}
	if got := lintFindingIDs(failures); len(got) != 1 || got[0] != "error" {
		t.Fatalf("error gate failures = %#v", got)
	}
}

func TestLintGateFailuresRejectsUnknownSeverity(t *testing.T) {
	_, err := lintGateFailures(nil, "minor")
	if err == nil {
		t.Fatal("expected unknown fail-on severity error")
	}
}

func TestSortLintFindingsOrdersBySeverityCategoryRuleAndTarget(t *testing.T) {
	findings := []api.CatalogLintFinding{
		{ID: "info", Severity: "info", Category: "eval", RuleID: "b", PrimaryDefinitionID: "z"},
		{ID: "warning-b", Severity: "warning", Category: "memory", RuleID: "b", PrimaryDefinitionID: "z"},
		{ID: "error", Severity: "error", Category: "eval", RuleID: "z", PrimaryDefinitionID: "z"},
		{ID: "warning-a", Severity: "warning", Category: "memory", RuleID: "a", PrimaryDefinitionID: "z"},
		{ID: "warning-target", Severity: "warning", Category: "memory", RuleID: "a", PrimaryDefinitionID: "a"},
	}

	sortLintFindings(findings)

	want := []string{"error", "warning-target", "warning-a", "warning-b", "info"}
	if got := lintFindingIDs(findings); len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("got %v, want %v", got, want)
			}
		}
	}
}

func lintFindingIDs(findings []api.CatalogLintFinding) []string {
	ids := make([]string, 0, len(findings))
	for _, finding := range findings {
		ids = append(ids, finding.ID)
	}
	return ids
}
