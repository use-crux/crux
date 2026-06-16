package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestRootHelpNamesQualityAsCanonicalEvaluationSurface(t *testing.T) {
	t.Setenv("NO_COLOR", "1")

	cmd := newRootCommand(&cli.Factory{})
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"--help"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("root help error: %v\n%s", err, out.String())
	}

	text := out.String()
	for _, want := range []string{
		"Quality",
		"quality",
		"Run source-defined evaluations and inspect experiments",
		"flows",
		"List runtime flow sessions",
		"Run crux quality --help for the evaluation workflow",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("root help missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "evals") ||
		strings.Contains(text, "crux eval") ||
		strings.Contains(text, "Compatibility alias") ||
		strings.Contains(text, "Run prompt and flow evals") ||
		strings.Contains(text, "List past eval runs") {
		t.Fatalf("root help still advertises legacy evals wording:\n%s", text)
	}
}

func TestRootCommandDoesNotRegisterLegacyEvalCommands(t *testing.T) {
	t.Setenv("NO_COLOR", "1")

	for _, legacyCommand := range []string{"eval", "evals"} {
		cmd := newRootCommand(&cli.Factory{})
		var out bytes.Buffer
		cmd.SetOut(&out)
		cmd.SetErr(&out)
		cmd.SetArgs([]string{legacyCommand, "--help"})

		err := cmd.Execute()
		if err == nil {
			t.Fatalf("legacy command %q still executed successfully:\n%s", legacyCommand, out.String())
		}
		if !strings.Contains(err.Error(), "unknown command") {
			t.Fatalf("legacy command %q returned unexpected error %v\n%s", legacyCommand, err, out.String())
		}
	}
}

func TestRootQualityHelpUsesQualityCommandHelp(t *testing.T) {
	t.Setenv("NO_COLOR", "1")

	cmd := newRootCommand(&cli.Factory{})
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"quality", "--help"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("quality help through root error: %v\n%s", err, out.String())
	}

	text := out.String()
	for _, want := range []string{
		"Quality is the canonical Crux evaluation surface.",
		"Available Commands:",
		"run",
		"Run source-defined evaluations and write experiment records",
		"cell-evidence",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("quality help through root missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "Compatibility alias") || strings.Contains(text, "crux eval") {
		t.Fatalf("quality help through root still mentions legacy eval:\n%s", text)
	}
}
