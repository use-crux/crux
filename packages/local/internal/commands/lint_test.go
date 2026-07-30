package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectIndexAPIPreservesLintSuppressionMetadata(t *testing.T) {
	index, err := projectIndexAPI(store.IndexData{LintFindings: []store.IndexLintFinding{{
		ID:         "suppressed",
		Suppressed: true,
		SuppressedBy: &store.IndexLintSuppressedBy{
			Source: &store.SourceLoc{File: "src/workflow.ts", Line: 7},
			Scope:  "next-line",
			Reason: "intentional handoff",
		},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(index.LintFindings) != 1 || index.LintFindings[0].SuppressedBy == nil {
		t.Fatalf("lint findings = %+v, want suppression metadata", index.LintFindings)
	}
	suppressedBy := index.LintFindings[0].SuppressedBy
	if suppressedBy.Scope != "next-line" || suppressedBy.Reason != "intentional handoff" || suppressedBy.Source == nil {
		t.Fatalf("suppressedBy = %+v, want complete metadata", suppressedBy)
	}

	activeJSON, err := json.Marshal(api.IndexLintFinding{ID: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(activeJSON), "suppressed") {
		t.Fatalf("active JSON = %s, want canonical omission", activeJSON)
	}
}

func TestSelectLintFindingsFiltersByProfileAndSuppression(t *testing.T) {
	findings := []api.IndexLintFinding{
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

func TestLintInputErrorsExitTwoBeforeIndexing(t *testing.T) {
	original := runProjectIndexForCommand
	defer func() { runProjectIndexForCommand = original }()
	called := false
	runProjectIndexForCommand = func(context.Context, oneshot.Options) (oneshot.Result, error) {
		called = true
		return oneshot.Result{}, nil
	}

	for _, test := range []struct {
		name string
		args []string
		want string
	}{
		{
			name: "profile",
			args: []string{"--profile", "bad"},
			want: `crux lint: unknown lint profile "bad" (expected off, recommended, strict, or experimental)`,
		},
		{
			name: "fail-on",
			args: []string{"--fail-on", "bad"},
			want: `crux lint: unknown --fail-on severity "bad" (expected error, warning, or info)`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			called = false
			var out, errOut bytes.Buffer
			cmd := NewLintCmd(cli.NewFactoryWithStreams(output.NewTestIO(&out, &errOut, output.TestIOOptions{})))
			cmd.SetArgs(test.args)
			err := cmd.Execute()
			var exit domain.ExitError
			if !errors.As(err, &exit) || exit.Code != 2 {
				t.Fatalf("error = %v, want exit code 2", err)
			}
			if called {
				t.Fatal("Project Index worker ran before lint input validation")
			}
			if strings.TrimSpace(errOut.String()) != test.want {
				t.Fatalf("stderr = %q, want %q", errOut.String(), test.want)
			}
		})
	}
}

func TestLintGateFailuresIsExplicitAndSeverityThresholded(t *testing.T) {
	findings := []api.IndexLintFinding{
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

func TestLintGateFailuresNeverGateSuppressedFindings(t *testing.T) {
	findings := []api.IndexLintFinding{
		{ID: "suppressed-error", Severity: "error", Suppressed: true},
		{ID: "suppressed-warning", Severity: "warning", Suppressed: true},
		{ID: "active-warning", Severity: "warning"},
	}

	for _, threshold := range []string{"error", "warning", "info"} {
		failures, err := lintGateFailures(findings, threshold)
		if err != nil {
			t.Fatal(err)
		}
		want := []string{}
		if threshold != "error" {
			want = []string{"active-warning"}
		}
		if got := lintFindingIDs(failures); strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("%s failures = %v, want %v", threshold, got, want)
		}
	}
}

func TestWriteLintResultIncludesSuppressedWithoutFailingGate(t *testing.T) {
	var stdout, stderr bytes.Buffer
	io := output.NewTestIO(&stdout, &stderr, output.TestIOOptions{})
	finding := api.IndexLintFinding{
		ID: "suppressed", Severity: "error", Profiles: []string{"recommended"}, Suppressed: true,
		SuppressedBy: &api.IndexLintSuppressedBy{
			Source: &api.SourceLoc{File: "src/workflow.ts", Line: 7},
			Scope:  "next-line", Reason: "intentional handoff",
		},
	}

	err := writeLintResult(io, api.IndexData{LintFindings: []api.IndexLintFinding{finding}}, lintOptions{
		profile: "recommended", includeSuppressed: true, failOn: "error", json: true,
	})
	if err != nil {
		t.Fatalf("writeLintResult error = %v, want suppressed-only exit success", err)
	}
	var got []api.IndexLintFinding
	if err := json.Unmarshal(stdout.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].SuppressedBy == nil || got[0].SuppressedBy.Scope != "next-line" {
		t.Fatalf("JSON findings = %+v, want complete retained suppression", got)
	}
}

func TestPrintLintFindingsLabelsSuppressedDirectiveEvidence(t *testing.T) {
	var stdout bytes.Buffer
	io := output.NewTestIO(&stdout, &bytes.Buffer{}, output.TestIOOptions{})
	printLintFindings(io, []api.IndexLintFinding{{
		ID: "suppressed", Severity: "warning", RuleID: "example.rule", Title: "Example rule",
		Suppressed: true,
		SuppressedBy: &api.IndexLintSuppressedBy{
			Source: &api.SourceLoc{File: "src/workflow.ts", Line: 7},
			Scope:  "next-line", Reason: "intentional handoff",
		},
	}}, "recommended", true)

	for _, want := range []string{"suppressed", "intentional handoff", "src/workflow.ts:7", "next-line"} {
		if !strings.Contains(stdout.String(), want) {
			t.Fatalf("output = %q, want %q", stdout.String(), want)
		}
	}
	if !strings.Contains(stdout.String(), "0 warning") {
		t.Fatalf("output = %q, want active-only severity summary", stdout.String())
	}
}

func TestLintGateFailuresRejectsUnknownSeverity(t *testing.T) {
	_, err := lintGateFailures(nil, "minor")
	if err == nil {
		t.Fatal("expected unknown fail-on severity error")
	}
}

func TestLintGateFailuresTreatsNoneAsExplicitNoGate(t *testing.T) {
	failures, err := lintGateFailures([]api.IndexLintFinding{{Severity: "error"}}, "none")
	if err != nil {
		t.Fatal(err)
	}
	if len(failures) != 0 {
		t.Fatalf("failures = %#v, want none", failures)
	}
}

func TestSortLintFindingsOrdersBySeverityCategoryRuleAndTarget(t *testing.T) {
	findings := []api.IndexLintFinding{
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

func lintFindingIDs(findings []api.IndexLintFinding) []string {
	ids := make([]string, 0, len(findings))
	for _, finding := range findings {
		ids = append(ids, finding.ID)
	}
	return ids
}
