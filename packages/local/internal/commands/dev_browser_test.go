package commands

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestDevExistingServerDoesNotOpenBrowserByDefault(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{Term: "xterm-256color"})
	factory := cli.NewFactoryWithStreams(streams)
	calls := 0
	cmd := newDevCmd(factory, devDependencies{
		browser: func(context.Context, string) error {
			calls++
			return nil
		},
		serverRunning:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
	})

	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("execute dev: %v\n%s", err, errOut.String())
	}
	if calls != 0 {
		t.Fatalf("browser calls = %d, want 0", calls)
	}
	if text := out.String() + errOut.String(); strings.Contains(text, "\x1b") {
		t.Fatalf("automatic plain mode emitted a terminal escape: %q", text)
	}
}

func TestDevExplicitNoTUIDoesNotOpenBrowserByDefault(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{
		StdinTTY: true, StdoutTTY: true, Term: "xterm-256color",
	})
	factory := cli.NewFactoryWithStreams(streams)
	calls := 0
	cmd := newDevCmd(factory, devDependencies{
		browser: func(context.Context, string) error {
			calls++
			return nil
		},
		serverRunning:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
	})
	cmd.SetArgs([]string{"--no-tui"})

	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("execute dev --no-tui: %v\n%s", err, errOut.String())
	}
	if calls != 0 {
		t.Fatalf("browser calls = %d, want 0", calls)
	}
}

func TestDevTUIPathDoesNotOpenBrowserBeforeServerOwnership(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{
		StdinTTY: true, StdoutTTY: true, Term: "xterm-256color",
	})
	calls := 0
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		browser: func(context.Context, string) error {
			calls++
			return nil
		},
		serverRunning:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
	})

	if err := cmd.ExecuteContext(context.Background()); err == nil {
		t.Fatal("TUI unexpectedly reused a foreign server")
	}
	if calls != 0 {
		t.Fatalf("browser calls = %d, want 0", calls)
	}
}

func TestDevTUIExistingServerOpenCallsBrowserBeforeOwnershipError(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{
		StdinTTY: true, StdoutTTY: true, Term: "xterm-256color",
	})
	calls := 0
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		browser: func(_ context.Context, url string) error {
			calls++
			if url != "http://localhost:4400" {
				t.Fatalf("browser URL = %q", url)
			}
			return nil
		},
		serverRunning:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
	})
	cmd.SetArgs([]string{"--open"})

	if err := cmd.ExecuteContext(context.Background()); err == nil {
		t.Fatal("TUI unexpectedly reused a foreign server")
	}
	if calls != 1 {
		t.Fatalf("browser calls = %d, want 1", calls)
	}
}

func TestDevExistingServerOpenCallsBrowserExactlyOnce(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{Term: "xterm-256color"})
	factory := cli.NewFactoryWithStreams(streams)
	calls := 0
	cmd := newDevCmd(factory, devDependencies{
		browser: func(_ context.Context, url string) error {
			calls++
			if url != "http://localhost:4400" {
				t.Fatalf("browser URL = %q", url)
			}
			return nil
		},
		serverRunning:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
	})
	cmd.SetArgs([]string{"--open"})

	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("execute dev --open: %v\n%s", err, errOut.String())
	}
	if calls != 1 {
		t.Fatalf("browser calls = %d, want 1", calls)
	}
}

func TestDevBrowserLaunchFailureIsNonFatalAndUsesInjectedErrorStream(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{Term: "xterm-256color"})
	factory := cli.NewFactoryWithStreams(streams)
	cmd := newDevCmd(factory, devDependencies{
		browser: func(context.Context, string) error {
			return errors.New("launcher unavailable")
		},
		serverRunning:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
	})
	cmd.SetArgs([]string{"--open"})

	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("browser failure became fatal: %v", err)
	}
	if got := errOut.String(); !strings.Contains(got, "Browser launch failed: launcher unavailable") {
		t.Fatalf("injected stderr missing browser failure: %q", got)
	}
}

func TestDevBrowserLaunchFailureSanitizesAndBoundsDiagnostic(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{Width: 70})
	unsafeError := "\x1b[31mboom\n" + strings.Repeat("界", 1000)

	launchBrowser(context.Background(), streams, true, "http://localhost:4400", func(context.Context, string) error {
		return errors.New(unsafeError)
	})

	diagnostic := errOut.String()
	if strings.Contains(diagnostic, "\x1b") {
		t.Fatalf("browser diagnostic retained terminal controls: %q", diagnostic)
	}
	if strings.Count(diagnostic, "\n") != 1 {
		t.Fatalf("browser diagnostic escaped its single row: %q", diagnostic)
	}
	if width := lipgloss.Width(strings.TrimSuffix(ansi.Strip(diagnostic), "\n")); width > streams.Width() {
		t.Fatalf("browser diagnostic width = %d, want <= %d: %q", width, streams.Width(), diagnostic)
	}
}

func TestDevBrowserFlagsExposeOnlyExplicitOpen(t *testing.T) {
	cmd := NewDevCmd(cli.NewFactoryWithStreams(output.NewTestIO(
		&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{},
	)))
	if cmd.Flags().Lookup("open") == nil {
		t.Fatal("dev command is missing --open")
	}
	for _, removed := range []string{"no-open"} {
		if cmd.Flags().Lookup(removed) != nil {
			t.Fatalf("dev command retained removed --%s flag", removed)
		}
	}
	if cmd.Flags().Lookup("tui") == nil || cmd.Flags().Lookup("no-tui") == nil {
		t.Fatal("dev command is missing explicit TUI mode flags")
	}
}
