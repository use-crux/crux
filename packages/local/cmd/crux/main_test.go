package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/cobra"
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
	if strings.Contains(text, "\x1b") {
		t.Fatalf("root help with NO_COLOR contained an ANSI escape:\n%q", text)
	}
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

func TestRootCommandRegistersDaemonFreeCheck(t *testing.T) {
	root := newRootCommand(&cli.Factory{})
	check, _, err := root.Find([]string{"check"})
	if err != nil {
		t.Fatal(err)
	}
	if check == nil || check.Name() != "check" {
		t.Fatalf("check command = %#v", check)
	}
	for _, flag := range []string{"root", "config", "project-id", "profile", "include-suppressed", "fail-on", "json"} {
		if check.Flags().Lookup(flag) == nil {
			t.Fatalf("check missing --%s", flag)
		}
	}
}

func TestRootCompletionCommandIsDiscoverable(t *testing.T) {
	root := newRootCommand(&cli.Factory{})
	// Cobra adds the completion command lazily; materialize it the same way
	// Execute would so we can assert on its visibility.
	root.InitDefaultCompletionCmd()

	var completion *cobra.Command
	for _, c := range root.Commands() {
		if c.Name() == "completion" {
			completion = c
			break
		}
	}
	if completion == nil {
		t.Fatal("root command has no completion subcommand")
	}
	if completion.Hidden {
		t.Fatal("completion command is hidden — un-hide it for discoverability (clig R7)")
	}
}

func TestRootCompletionEmitsShellScripts(t *testing.T) {
	for _, tc := range []struct {
		shell string
		want  string
	}{
		{"bash", "__start_crux"},
		{"zsh", "compdef"},
		{"fish", "fish completion for crux"},
	} {
		t.Run(tc.shell, func(t *testing.T) {
			cmd := newRootCommand(&cli.Factory{})
			var out bytes.Buffer
			cmd.SetOut(&out)
			cmd.SetErr(&out)
			cmd.SetArgs([]string{"completion", tc.shell})

			if err := cmd.Execute(); err != nil {
				t.Fatalf("completion %s error: %v\n%s", tc.shell, err, out.String())
			}
			if !strings.Contains(out.String(), tc.want) {
				t.Fatalf("completion %s output missing %q:\n%s", tc.shell, tc.want, out.String())
			}
		})
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
