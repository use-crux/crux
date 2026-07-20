package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestSetupCommandRoutesModesToWorker(t *testing.T) {
	old := runSetupOperationForCommand
	defer func() { runSetupOperationForCommand = old }()
	for _, tc := range []struct {
		name string
		args []string
		mode string
	}{
		{"default check", nil, "check"},
		{"explicit check", []string{"--check"}, "check"},
		{"apply", []string{"--apply"}, "apply"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out, errOut bytes.Buffer
			streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
			runSetupOperationForCommand = func(_ context.Context, _, mode string, process commandWorkerProcess) (json.RawMessage, error) {
				if process.stderr != streams.Err {
					t.Fatal("setup worker stderr did not use the factory IO")
				}
				if mode != tc.mode {
					t.Fatalf("mode = %q", mode)
				}
				return json.RawMessage(`{"ok":true,"mode":"` + mode + `","findings":[],"actions":[],"applied":[]}`), nil
			}
			cmd := NewSetupCmd(cli.NewFactoryWithStreams(streams))
			cmd.SetArgs(append([]string{"--json"}, tc.args...))
			if err := cmd.Execute(); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(out.String(), `"mode": "`+tc.mode+`"`) {
				t.Fatalf("setup JSON did not use factory output: %q", out.String())
			}
		})
	}
}

func TestSetupHumanOutputGroupsContributorsAndShowsRemediation(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{ColorEnabled: false})
	report := setupReport{OK: false}
	report.Findings = append(report.Findings,
		setupFinding{
			ContributorID: "runtime",
			Code:          "TABLE_MISSING",
			Resource:      "work",
			Message:       "Runtime table is missing.",
			Remediation:   "crux setup --apply",
		},
		setupFinding{
			ContributorID: "defer",
			Code:          "DEFER_NEXT_INTEGRATION_MISSING",
			Resource:      "@use-crux/next",
			Message:       "Next integration is missing.",
		},
	)

	if err := printSetupResult(streams, report); err != nil {
		t.Fatal(err)
	}
	text := out.String()
	for _, expected := range []string{
		"runtime\n",
		"defer\n",
		"TABLE_MISSING work: Runtime table is missing.",
		"fix: crux setup --apply",
		"Setup needs attention",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("output missing %q:\n%s", expected, text)
		}
	}
}

func TestSetupReturnsExitOneAfterWritingAnUnhealthyReport(t *testing.T) {
	old := runSetupOperationForCommand
	defer func() { runSetupOperationForCommand = old }()
	runSetupOperationForCommand = func(context.Context, string, string, commandWorkerProcess) (json.RawMessage, error) {
		return json.RawMessage(`{"ok":false,"mode":"check","findings":[{"contributorId":"runtime","code":"TABLE_MISSING","resource":"work","severity":"error","message":"missing"}],"actions":[],"applied":[]}`), nil
	}

	var out, errOut strings.Builder
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	cmd := NewSetupCmd(cli.NewFactoryWithStreams(streams))
	cmd.SetArgs([]string{"--json"})
	err := cmd.Execute()
	var exitErr domain.ExitError
	if !errors.As(err, &exitErr) || exitErr.Code != 1 {
		t.Fatalf("error = %v, want exit 1", err)
	}
	if !strings.Contains(out.String(), `"TABLE_MISSING"`) {
		t.Fatalf("report was not written before exit:\n%s", out.String())
	}
	if errOut.Len() != 0 {
		t.Fatalf("intentional setup exit wrote error noise:\n%s", errOut.String())
	}
}

func TestSetupRejectsCheckAndApply(t *testing.T) {
	cmd := NewSetupCmd(&cli.Factory{})
	cmd.SetArgs([]string{"--check", "--apply"})
	if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "at most one") {
		t.Fatalf("error = %v", err)
	}
}
