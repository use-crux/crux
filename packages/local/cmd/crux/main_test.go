package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestRootHelpUsesFactoryOutputWithoutCobraStreamOverrides(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	cmd := newRootCommand(cli.NewFactoryWithStreams(streams))
	cmd.SetArgs([]string{"--help"})

	if err := cmd.Execute(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "crux <command> [flags]") {
		t.Fatalf("root help did not use factory output: %q", out.String())
	}
	if errOut.Len() != 0 {
		t.Fatalf("root help wrote diagnostics: %q", errOut.String())
	}
}

func TestRootHelpNamesEvalAsCanonicalSurfaceAndRemovesQuality(t *testing.T) {
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
		"Evals",
		"eval",
		"Run Evals and inspect Eval runs and Baselines",
		"flows",
		"List runtime flow sessions",
		"index",
		"List every current Catalog definition",
		"Run crux eval --help for the Eval workflow",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("root help missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "quality") || strings.Contains(text, "Quality") {
		t.Fatalf("root help still advertises removed Quality workflow:\n%s", text)
	}
	if strings.Contains(text, "Compatibility alias") ||
		strings.Contains(text, "Run prompt and flow evals") ||
		strings.Contains(text, "List past eval runs") {
		t.Fatalf("root help still advertises legacy evals wording:\n%s", text)
	}
}

func TestRootJSONFlagIsPersistentAndRejectsUnsupportedCommandsClearly(t *testing.T) {
	root := newRootCommand(&cli.Factory{})
	for _, path := range [][]string{
		{"traces"},
		{"catalog", "show"},
		{"runtime", "status"},
		{"eval"},
		{"eval", "list"},
		{"eval", "show"},
	} {
		command, _, err := root.Find(path)
		if err != nil {
			t.Fatalf("find %v: %v", path, err)
		}
		if !commandSupportsJSON(command) {
			t.Errorf("%s should support global JSON", command.CommandPath())
		}
	}
	baseline, _, err := root.Find([]string{"eval", "baseline", "set"})
	if err != nil {
		t.Fatal(err)
	}
	if commandSupportsJSON(baseline) {
		t.Error("eval baseline set should reject global JSON until it has JSON output")
	}

	var out bytes.Buffer
	root.SetOut(&out)
	root.SetErr(&out)
	root.SetArgs([]string{"--json", "dev"})
	err = root.Execute()
	var exit domain.ExitError
	if !errors.As(err, &exit) || exit.Code != 2 {
		t.Fatalf("unsupported JSON error = %v, want exit code 2", err)
	}
	if strings.TrimSpace(out.String()) != "crux dev has no JSON output yet" {
		t.Fatalf("unsupported JSON output = %q", out.String())
	}
}

func TestRootCommandRegistersNewEvalButNotLegacyEvalsAlias(t *testing.T) {
	t.Setenv("NO_COLOR", "1")

	eval := newRootCommand(&cli.Factory{})
	eval.SetArgs([]string{"eval", "--help"})
	if err := eval.Execute(); err != nil {
		t.Fatalf("new eval command is unavailable: %v", err)
	}

	for _, legacyCommand := range []string{"evals"} {
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

func TestRootCommandRegistersLSPCommandSurface(t *testing.T) {
	root := newRootCommand(&cli.Factory{})
	lsp, _, err := root.Find([]string{"lsp"})
	if err != nil {
		t.Fatal(err)
	}
	if lsp == nil || lsp.Name() != "lsp" {
		t.Fatalf("lsp command = %#v", lsp)
	}
	if lsp.Flags().Lookup("root") == nil {
		t.Fatal("lsp command is missing --root")
	}
	if lsp.InheritedFlags().Lookup("port") == nil {
		t.Fatal("lsp command is missing inherited --port")
	}
}

func TestRootCommandRegistersExplicitEditorInstaller(t *testing.T) {
	root := newRootCommand(&cli.Factory{})
	install, _, err := root.Find([]string{"editor", "install"})
	if err != nil {
		t.Fatal(err)
	}
	if install == nil || install.Use != "install <vscode|cursor>" {
		t.Fatalf("editor install command = %#v", install)
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

func TestRootQualityCommandIsRemoved(t *testing.T) {
	t.Setenv("NO_COLOR", "1")

	cmd := newRootCommand(&cli.Factory{})
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"quality", "--help"})

	if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("removed quality command result = %v\n%s", err, out.String())
	}
}
