package commands

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/tui"
)

func TestDevServerReceivesCommandScopedDiagnostics(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	var options server.DevServerOptions
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning: func(int) bool { return false },
		portAvailable: func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {
		},
		newServer: func(got server.DevServerOptions) devServerSession {
			options = got
			return &fakeDevServerSession{}
		},
	})
	cmd.SetArgs([]string{"--no-tui"})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := cmd.ExecuteContext(ctx); err != nil {
		t.Fatalf("execute dev: %v", err)
	}
	if options.Logger == nil {
		t.Fatal("dev server did not receive a command-scoped logger")
	}
	options.Logger.Warn("owned server warning")
	if got := errOut.String(); !strings.Contains(got, "owned server warning") {
		t.Fatalf("plain server logger did not use injected stderr: %q", got)
	}
	if options.Stderr != streams.Err {
		t.Fatal("dev server did not receive injected stderr")
	}
	if options.Quiet {
		t.Fatal("plain dev server unexpectedly suppressed scoped diagnostics")
	}
}

func TestDevOwnedServerBrowserBehaviorAcrossModes(t *testing.T) {
	tests := []struct {
		name             string
		terminal         output.TestIOOptions
		args             []string
		wantBrowserCalls int
		wantTUICalls     int
		wantQuiet        bool
	}{
		{
			name:         "TUI default",
			terminal:     interactiveDevTestIO(),
			wantTUICalls: 1,
			wantQuiet:    true,
		},
		{
			name:         "explicit TUI",
			terminal:     interactiveDevTestIO(),
			args:         []string{"--tui"},
			wantTUICalls: 1,
			wantQuiet:    true,
		},
		{
			name:             "TUI explicit open",
			terminal:         interactiveDevTestIO(),
			args:             []string{"--open"},
			wantBrowserCalls: 1,
			wantTUICalls:     1,
			wantQuiet:        true,
		},
		{
			name:     "explicit plain default",
			terminal: interactiveDevTestIO(),
			args:     []string{"--no-tui"},
		},
		{
			name:             "explicit plain open",
			terminal:         interactiveDevTestIO(),
			args:             []string{"--no-tui", "--open"},
			wantBrowserCalls: 1,
		},
		{
			name: "CI default",
			terminal: output.TestIOOptions{
				StdinTTY: true, StdoutTTY: true, CI: true, Term: "xterm-256color",
			},
		},
		{
			name: "CI explicit open",
			terminal: output.TestIOOptions{
				StdinTTY: true, StdoutTTY: true, CI: true, Term: "xterm-256color",
			},
			args:             []string{"--open"},
			wantBrowserCalls: 1,
		},
		{
			name:     "non-TTY default",
			terminal: output.TestIOOptions{Term: "xterm-256color"},
		},
		{
			name:             "non-TTY explicit open",
			terminal:         output.TestIOOptions{Term: "xterm-256color"},
			args:             []string{"--open"},
			wantBrowserCalls: 1,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var out, errOut bytes.Buffer
			streams := output.NewTestIO(&out, &errOut, test.terminal)
			session := &fakeDevServerSession{}
			browserCalls := 0
			tuiCalls := 0
			var options server.DevServerOptions
			cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
				browser: func(_ context.Context, url string) error {
					browserCalls++
					if url != session.LocalURL() {
						t.Fatalf("browser URL = %q, want %q", url, session.LocalURL())
					}
					return nil
				},
				serverRunning:    func(int) bool { return false },
				portAvailable:    func(int) bool { return true },
				runtimePreflight: func(context.Context, *output.IO) {},
				newServer: func(got server.DevServerOptions) devServerSession {
					options = got
					return session
				},
				runTUI: func(_ context.Context, _ *output.IO, _ devServerSession, _ string, _ int, _ *startupTracker, _ <-chan string, _ tui.BrowserOpener, shutdown func() error) error {
					tuiCalls++
					return shutdown()
				},
			})
			cmd.SetArgs(test.args)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()

			if err := cmd.ExecuteContext(ctx); err != nil {
				t.Fatalf("execute dev: %v", err)
			}
			if browserCalls != test.wantBrowserCalls {
				t.Fatalf("browser calls = %d, want %d", browserCalls, test.wantBrowserCalls)
			}
			if tuiCalls != test.wantTUICalls {
				t.Fatalf("TUI calls = %d, want %d", tuiCalls, test.wantTUICalls)
			}
			if options.Quiet != test.wantQuiet {
				t.Fatalf("server Quiet = %t, want %t", options.Quiet, test.wantQuiet)
			}
			if session.started != 1 || session.shutdown != 1 {
				t.Fatalf("server lifecycle = start %d, shutdown %d; want 1 each", session.started, session.shutdown)
			}
		})
	}
}

func TestDevTUIShutdownReturnsAfterOneBoundedJoin(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, interactiveDevTestIO())
	releaseWorker := make(chan struct{})
	defer close(releaseWorker)
	session := &fakeDevServerSession{}
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning:    func(int) bool { return false },
		portAvailable:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
		shutdownTimeout:  30 * time.Millisecond,
		newServer: func(options server.DevServerOptions) devServerSession {
			session.shutdownFunc = func(ctx context.Context) error {
				return options.SessionWorkers.Wait(ctx)
			}
			if !options.SessionWorkers.Go(func() { <-releaseWorker }) {
				t.Fatal("test worker was not admitted")
			}
			return session
		},
		runTUI: func(_ context.Context, _ *output.IO, _ devServerSession, _ string, _ int, _ *startupTracker, _ <-chan string, _ tui.BrowserOpener, shutdown func() error) error {
			return shutdown()
		},
	})
	cmd.SetArgs([]string{"--tui"})
	started := time.Now()
	err := cmd.ExecuteContext(context.Background())
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("dev error = %v, want bounded cleanup deadline", err)
	}
	if elapsed := time.Since(started); elapsed > 250*time.Millisecond {
		t.Fatalf("bounded TUI cleanup took %s", elapsed)
	}
}

func TestDevPlainTunnelStartupFailureReportsPromptlyAndRemainsNonfatal(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	session := &fakeDevServerSession{
		startTunnel: func(_ context.Context, report func(server.TunnelStartupResult)) {
			report(server.TunnelStartupResult{Err: errors.New("tunnel unavailable")})
			go func() {
				time.Sleep(10 * time.Millisecond)
				cancel()
			}()
		},
	}
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning:    func(int) bool { return false },
		portAvailable:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
		newServer: func(server.DevServerOptions) devServerSession {
			return session
		},
	})
	cmd.SetArgs([]string{"--no-tui", "--tunnel"})

	started := time.Now()
	if err := cmd.ExecuteContext(ctx); err != nil {
		t.Fatalf("execute dev: %v", err)
	}
	if elapsed := time.Since(started); elapsed >= time.Second {
		t.Fatalf("dev returned after %s, want prompt tunnel failure handling", elapsed)
	}
	if got := errOut.String(); !strings.Contains(got, "Tunnel failed to start: tunnel unavailable") {
		t.Fatalf("stderr = %q, want immediate tunnel startup failure", got)
	}
	if session.shutdown != 1 {
		t.Fatalf("shutdown calls = %d, want 1", session.shutdown)
	}
}

func TestDevPlainTunnelStartupCancellationStopsBeforeReadyOrBrowser(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	startupCalled := make(chan struct{})
	browserCalls := 0
	session := &fakeDevServerSession{
		startTunnel: func(context.Context, func(server.TunnelStartupResult)) {
			close(startupCalled)
		},
	}
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		browser: func(context.Context, string) error {
			browserCalls++
			return context.Canceled
		},
		serverRunning:    func(int) bool { return false },
		portAvailable:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
		newServer: func(server.DevServerOptions) devServerSession {
			return session
		},
	})
	cmd.SetArgs([]string{"--no-tui", "--tunnel", "--open"})
	ctx, cancel := context.WithCancel(context.Background())
	returned := make(chan error, 1)
	go func() {
		returned <- cmd.ExecuteContext(ctx)
	}()

	select {
	case <-startupCalled:
	case <-time.After(time.Second):
		t.Fatal("tunnel startup was not called")
	}
	cancel()
	select {
	case err := <-returned:
		if err != nil {
			t.Fatalf("execute dev: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("dev did not return promptly after tunnel startup cancellation")
	}
	if session.shutdown != 1 {
		t.Fatalf("shutdown calls = %d, want 1", session.shutdown)
	}
	if browserCalls != 0 {
		t.Fatalf("browser calls = %d, want 0 after startup cancellation", browserCalls)
	}
	got := errOut.String()
	if !strings.Contains(got, "Shutting down") {
		t.Fatalf("stderr = %q, want normal shutdown status", got)
	}
	for _, unexpected := range []string{"Server ready", "Browser launch failed"} {
		if strings.Contains(got, unexpected) {
			t.Fatalf("stderr = %q, must not contain %q after startup cancellation", got, unexpected)
		}
	}
}

func TestDevPlainTunnelReportedCancellationStopsBeforeReadyOrBrowser(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	browserCalls := 0
	session := &fakeDevServerSession{
		startTunnel: func(_ context.Context, report func(server.TunnelStartupResult)) {
			report(server.TunnelStartupResult{Err: context.Canceled})
		},
	}
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		browser: func(context.Context, string) error {
			browserCalls++
			return nil
		},
		serverRunning:    func(int) bool { return false },
		portAvailable:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
		newServer: func(server.DevServerOptions) devServerSession {
			return session
		},
	})
	cmd.SetArgs([]string{"--no-tui", "--tunnel", "--open"})

	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("execute dev: %v", err)
	}
	if session.shutdown != 1 {
		t.Fatalf("shutdown calls = %d, want 1", session.shutdown)
	}
	if browserCalls != 0 {
		t.Fatalf("browser calls = %d, want 0 after reported cancellation", browserCalls)
	}
	got := errOut.String()
	if !strings.Contains(got, "Shutting down") {
		t.Fatalf("stderr = %q, want normal shutdown status", got)
	}
	for _, unexpected := range []string{"Tunnel failed", "Server ready", "Browser launch failed"} {
		if strings.Contains(got, unexpected) {
			t.Fatalf("stderr = %q, must not contain %q after reported cancellation", got, unexpected)
		}
	}
}

func interactiveDevTestIO() output.TestIOOptions {
	return output.TestIOOptions{
		StdinTTY: true, StdoutTTY: true, Term: "xterm-256color",
	}
}

type fakeDevServerSession struct {
	started      int
	shutdown     int
	startTunnel  func(context.Context, func(server.TunnelStartupResult))
	shutdownFunc func(context.Context) error
}

func (server *fakeDevServerSession) Start() error {
	server.started++
	return nil
}

func (server *fakeDevServerSession) Shutdown(ctx context.Context) error {
	server.shutdown++
	if server.shutdownFunc != nil {
		return server.shutdownFunc(ctx)
	}
	return nil
}

func (*fakeDevServerSession) LocalGated() bool { return false }

func (*fakeDevServerSession) LocalURL() string { return "http://localhost:4400" }

func (session *fakeDevServerSession) StartTunnel(ctx context.Context, report func(server.TunnelStartupResult)) {
	if session.startTunnel != nil {
		session.startTunnel(ctx, report)
	}
}

func (*fakeDevServerSession) IngestCredentials() (string, string) { return "", "" }

func (*fakeDevServerSession) Native() *server.DevServer { return nil }
