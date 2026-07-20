package commands

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestDevExplicitTUIRejectsIncapableTerminalBeforeStartup(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{Term: "xterm-256color"})
	preflightCalls := 0
	serverChecks := 0
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		runtimePreflight: func(context.Context, *output.IO) { preflightCalls++ },
		serverRunning: func(int) bool {
			serverChecks++
			return true
		},
	})
	cmd.SetArgs([]string{"--tui"})

	err := cmd.ExecuteContext(context.Background())
	if err == nil || !strings.Contains(err.Error(), "--tui requires an interactive terminal") {
		t.Fatalf("execute error = %v, want explicit TUI capability error", err)
	}
	if preflightCalls != 0 || serverChecks != 0 {
		t.Fatalf("startup ran after capability error: preflight=%d serverChecks=%d", preflightCalls, serverChecks)
	}
	if out.Len() != 0 || errOut.Len() != 0 {
		t.Fatalf("capability validation wrote output: stdout=%q stderr=%q", out.String(), errOut.String())
	}
}

func TestDevRejectsConflictingTUIFlagsBeforeStartup(t *testing.T) {
	streams := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, interactiveDevTestIO())
	preflightCalls := 0
	serverChecks := 0
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		runtimePreflight: func(context.Context, *output.IO) { preflightCalls++ },
		serverRunning: func(int) bool {
			serverChecks++
			return false
		},
	})
	cmd.SetArgs([]string{"--tui", "--no-tui"})

	err := cmd.ExecuteContext(context.Background())
	if err == nil || !strings.Contains(err.Error(), "were all set") {
		t.Fatalf("execute error = %v, want conflicting flag error", err)
	}
	if preflightCalls != 0 || serverChecks != 0 {
		t.Fatalf("startup ran after flag conflict: preflight=%d serverChecks=%d", preflightCalls, serverChecks)
	}
}

func TestSelectDevModeRequiresAnInteractiveTerminal(t *testing.T) {
	tests := []struct {
		name string
		in   devModeInput
		want devMode
	}{
		{
			name: "capable terminal",
			in:   devModeInput{StdinTTY: true, StdoutTTY: true, Term: "xterm-256color"},
			want: devModeTUI,
		},
		{
			name: "redirected stdin",
			in:   devModeInput{StdoutTTY: true, Term: "xterm-256color"},
			want: devModePlain,
		},
		{
			name: "redirected stdout",
			in:   devModeInput{StdinTTY: true, Term: "xterm-256color"},
			want: devModePlain,
		},
		{
			name: "CI",
			in:   devModeInput{StdinTTY: true, StdoutTTY: true, CI: true, Term: "xterm-256color"},
			want: devModePlain,
		},
		{
			name: "dumb terminal",
			in:   devModeInput{StdinTTY: true, StdoutTTY: true, Term: "dumb"},
			want: devModePlain,
		},
		{
			name: "explicit no TUI",
			in:   devModeInput{NoTUI: true, StdinTTY: true, StdoutTTY: true, Term: "xterm-256color"},
			want: devModePlain,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := selectDevMode(test.in); got != test.want {
				t.Fatalf("selectDevMode(%+v) = %q, want %q", test.in, got, test.want)
			}
		})
	}
}
