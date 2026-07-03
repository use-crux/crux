package commands

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func assertCommandGolden(t *testing.T, name string, got string) {
	t.Helper()
	if strings.Contains(got, "\x1b") {
		t.Fatalf("%s golden output contained an ANSI escape:\n%q", name, got)
	}
	path := filepath.Join("testdata", "cli-goldens", name+".golden")
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s: %v\nactual:\n%s", path, err, got)
	}
	if got != string(want) {
		t.Fatalf("%s golden mismatch\n--- want\n%s\n--- got\n%s", name, string(want), got)
	}
}

func TestCLIPlainGoldens(t *testing.T) {
	t.Run("flows", func(t *testing.T) {
		forceAsciiProfile(t)
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printFlows(io, []api.RuntimeFlowRun{
			{Name: "ingest", Status: "success", SessionID: "sess-abcdef0123456789", StartedAt: 1700000000000},
		})

		assertCommandGolden(t, "flows", out.String())
	})

	t.Run("lint", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printLintFindings(io, []api.IndexLintFinding{
			{
				Severity: "error", Title: "Missing description", RuleID: "rule.desc",
				Message: "prompt has no description", PrimaryDefinitionID: "my.prompt",
				Source: &api.SourceLoc{File: "a.eval.ts", Line: 5},
			},
		}, "recommended", false)

		assertCommandGolden(t, "lint", out.String())
	})

	t.Run("stats", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printStats(io, api.Stats{
			TotalExecutions: 3,
			SuccessCount:    2,
			ErrorCount:      1,
			TotalTokens:     1200,
			TotalCost:       0.42,
		})

		assertCommandGolden(t, "stats", out.String())
	})
}
