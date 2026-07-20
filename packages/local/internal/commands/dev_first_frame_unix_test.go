//go:build darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris || zos

package commands

import (
	"context"
	"errors"
	"io"
	"net"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	xterm "github.com/charmbracelet/x/term"
	"github.com/creack/pty"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestDevRendersRealTUIFrameBeforeWarmupCompletes(t *testing.T) {
	tests := []struct {
		name           string
		blockIndexer   bool
		blockArtifacts bool
	}{
		{name: "project index", blockIndexer: true},
		{name: "runtime artifacts", blockArtifacts: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			t.Chdir(root)
			master, terminal, err := pty.Open()
			if err != nil {
				t.Fatalf("open PTY: %v", err)
			}
			t.Cleanup(func() {
				_ = master.Close()
				_ = terminal.Close()
			})
			if err := pty.Setsize(master, &pty.Winsize{Rows: 30, Cols: 100}); err != nil {
				t.Fatalf("size PTY: %v", err)
			}

			transcript := &lockedTranscript{changed: make(chan struct{}, 1)}
			go transcript.read(master)
			streams := output.NewTestIO(terminal, terminal, output.TestIOOptions{
				In: terminal, StdinTTY: true, StdoutTTY: true, StderrTTY: true, Term: "xterm-256color", Width: 100,
			})
			preflightStarted := make(chan struct{})
			releasePreflight := make(chan struct{})
			warmupStarted := make(chan struct{})
			releaseWarmup := make(chan struct{})
			indexer := frameProjectIndexer{}
			artifacts := server.RuntimeArtifactGenerator(func(context.Context, string, []store.ProjectDefinition) error { return nil })
			if test.blockIndexer {
				indexer = frameProjectIndexer{started: warmupStarted, release: releaseWarmup}
			}
			if test.blockArtifacts {
				artifacts = func(ctx context.Context, _ string, _ []store.ProjectDefinition) error {
					close(warmupStarted)
					select {
					case <-releaseWarmup:
						return nil
					case <-ctx.Done():
						return ctx.Err()
					}
				}
			}

			port := availableCommandPort(t)
			cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
				serverRunning: func(int) bool { return false },
				portAvailable: func(int) bool { return true },
				runtimePreflight: func(ctx context.Context, _ *output.IO) {
					close(preflightStarted)
					select {
					case <-releasePreflight:
					case <-ctx.Done():
					}
				},
				newServer: func(options server.DevServerOptions) devServerSession {
					options.ProjectIndexer = indexer
					options.RuntimeArtifacts = artifacts
					options.ObservabilityDBPath = root + "/observability.sqlite"
					options.IngestTokenPath = root + "/ingest-token"
					return &nativeDevServerSession{server: server.NewDevServer(options)}
				},
			})
			cmd.SetArgs([]string{"--tui", "--port", strconv.Itoa(port)})

			startedAt := time.Now()
			returned := make(chan error, 1)
			go func() { returned <- cmd.ExecuteContext(context.Background()) }()
			waitForSignalBy(t, preflightStarted, startedAt.Add(time.Second), "runtime preflight")
			waitForSignalBy(t, warmupStarted, startedAt.Add(time.Second), test.name)
			transcript.waitForBy(t, "Overview", startedAt.Add(time.Second), returned)

			close(releasePreflight)
			close(releaseWarmup)
			if _, err := master.Write([]byte("q")); err != nil {
				t.Fatalf("quit TUI: %v", err)
			}
			select {
			case err := <-returned:
				if err != nil {
					t.Fatalf("execute dev: %v\n%s", err, transcript.String())
				}
			case <-time.After(5 * time.Second):
				t.Fatalf("dev did not stop after q\n%s", transcript.String())
			}
		})
	}
}

func TestDevJoinsWorkersBeforeRealTUIRestoresTerminal(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	master, terminal, err := pty.Open()
	if err != nil {
		t.Fatalf("open PTY: %v", err)
	}
	t.Cleanup(func() {
		_ = master.Close()
		_ = terminal.Close()
	})
	if err := pty.Setsize(master, &pty.Winsize{Rows: 30, Cols: 100}); err != nil {
		t.Fatalf("size PTY: %v", err)
	}
	initialTTY, err := xterm.GetState(master.Fd())
	if err != nil {
		t.Fatalf("capture initial PTY state: %v", err)
	}

	transcript := &lockedTranscript{changed: make(chan struct{}, 1)}
	go transcript.read(master)
	streams := output.NewTestIO(terminal, terminal, output.TestIOOptions{
		In: terminal, StdinTTY: true, StdoutTTY: true, StderrTTY: true, Term: "xterm-256color", Width: 100,
	})
	preflightStarted := make(chan struct{})
	sessionCanceled := make(chan struct{})
	releasePreflight := make(chan struct{})
	var tryLateAdmission func(func()) bool
	port := availableCommandPort(t)
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning: func(int) bool { return false },
		portAvailable: func(int) bool { return true },
		runtimePreflight: func(ctx context.Context, _ *output.IO) {
			close(preflightStarted)
			<-ctx.Done()
			close(sessionCanceled)
			<-releasePreflight // Model an admitted task that is slow to honor cancellation.
		},
		newServer: func(options server.DevServerOptions) devServerSession {
			tryLateAdmission = options.SessionWorkers.Go
			options.ProjectIndexer = frameProjectIndexer{}
			options.RuntimeArtifacts = func(context.Context, string, []store.ProjectDefinition) error { return nil }
			options.ObservabilityDBPath = root + "/observability.sqlite"
			options.IngestTokenPath = root + "/ingest-token"
			return &nativeDevServerSession{server: server.NewDevServer(options)}
		},
		shutdownTimeout: 20 * time.Millisecond,
	})
	cmd.SilenceErrors = true
	cmd.SilenceUsage = true
	cmd.SetArgs([]string{"--tui", "--port", strconv.Itoa(port)})

	returned := make(chan error, 1)
	go func() { returned <- cmd.ExecuteContext(context.Background()) }()
	waitForSignalBy(t, preflightStarted, time.Now().Add(time.Second), "runtime preflight")
	transcript.waitForBy(t, "Overview", time.Now().Add(time.Second), returned)
	if _, err := master.Write([]byte("q")); err != nil {
		t.Fatalf("quit TUI: %v", err)
	}
	waitForSignalBy(t, sessionCanceled, time.Now().Add(time.Second), "session cancellation")

	time.Sleep(75 * time.Millisecond) // Past the bounded server-cleanup timeout.
	select {
	case err := <-returned:
		t.Fatalf("dev returned before its admitted worker: %v\n%s", err, transcript.String())
	default:
	}
	if tryLateAdmission == nil {
		t.Fatal("server did not receive the session worker boundary")
	}
	if tryLateAdmission(func() {}) {
		t.Fatal("worker admission remained open after TUI shutdown began")
	}
	activeTTY, err := xterm.GetState(master.Fd())
	if err != nil {
		t.Fatalf("capture active PTY state: %v", err)
	}
	if reflect.DeepEqual(activeTTY, initialTTY) {
		t.Fatal("TUI restored the terminal before its admitted worker joined")
	}

	close(releasePreflight)
	select {
	case err := <-returned:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("execute dev error = %v, want surfaced cleanup deadline\n%s", err, transcript.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("dev did not stop after worker release\n%s", transcript.String())
	}
	restoredTTY, err := xterm.GetState(master.Fd())
	if err != nil {
		t.Fatalf("capture restored PTY state: %v", err)
	}
	if !reflect.DeepEqual(restoredTTY, initialTTY) {
		t.Fatal("TUI did not restore the terminal after its admitted worker joined")
	}
}

type frameProjectIndexer struct {
	started chan struct{}
	release chan struct{}
}

func (indexer frameProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, _, _ string) (projectindex.IndexPatch, error) {
	if indexer.started != nil {
		close(indexer.started)
		select {
		case <-indexer.release:
		case <-ctx.Done():
			return projectindex.IndexPatch{}, ctx.Err()
		}
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project:       store.ProjectIdentity{Root: root},
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
	}, nil
}

type lockedTranscript struct {
	mu      sync.Mutex
	text    strings.Builder
	changed chan struct{}
}

func (transcript *lockedTranscript) read(master io.Reader) {
	buffer := make([]byte, 4096)
	for {
		count, err := master.Read(buffer)
		if count > 0 {
			transcript.mu.Lock()
			_, _ = transcript.text.Write(buffer[:count])
			transcript.mu.Unlock()
			select {
			case transcript.changed <- struct{}{}:
			default:
			}
		}
		if err != nil {
			return
		}
	}
}

func (transcript *lockedTranscript) String() string {
	transcript.mu.Lock()
	defer transcript.mu.Unlock()
	return transcript.text.String()
}

func (transcript *lockedTranscript) waitForBy(t *testing.T, value string, deadline time.Time, returned <-chan error) {
	t.Helper()
	for !strings.Contains(transcript.String(), value) {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			t.Fatalf("first TUI frame missed one-second deadline waiting for %q:\n%s", value, transcript.String())
		}
		timer := time.NewTimer(remaining)
		select {
		case <-transcript.changed:
			if !timer.Stop() {
				<-timer.C
			}
		case err := <-returned:
			timer.Stop()
			t.Fatalf("dev returned before first TUI frame: %v\n%s", err, transcript.String())
		case <-timer.C:
			t.Fatalf("first TUI frame missed one-second deadline waiting for %q:\n%s", value, transcript.String())
		}
	}
}

func waitForSignalBy(t *testing.T, signal <-chan struct{}, deadline time.Time, name string) {
	t.Helper()
	remaining := time.Until(deadline)
	if remaining <= 0 {
		t.Fatalf("%s did not start before the first-frame deadline", name)
	}
	select {
	case <-signal:
	case <-time.After(remaining):
		t.Fatalf("%s did not start before the first-frame deadline", name)
	}
}

func availableCommandPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}
