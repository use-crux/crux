package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
	"github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/store"
	"github.com/use-crux/crux/packages/local/internal/tui"
)

type devPreflightContextKey struct{}

func TestDevTUIStartsWhileRuntimePreflightIsStillRunning(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, interactiveDevTestIO())
	preflightStarted := make(chan struct{})
	releasePreflight := make(chan struct{})
	tuiStarted := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releasePreflight) }) }
	t.Cleanup(release)

	session := &fakeDevServerSession{}
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning: func(int) bool { return false },
		portAvailable: func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {
			close(preflightStarted)
			<-releasePreflight
		},
		newServer: func(server.DevServerOptions) devServerSession { return session },
		runTUI: func(_ context.Context, _ *output.IO, _ devServerSession, _ string, _ int, _ *startupTracker, _ <-chan string, _ tui.BrowserOpener, shutdown func() error) error {
			close(tuiStarted)
			release()
			return shutdown()
		},
	})

	returned := make(chan error, 1)
	go func() { returned <- cmd.ExecuteContext(context.Background()) }()

	select {
	case <-preflightStarted:
	case <-time.After(time.Second):
		t.Fatal("runtime preflight did not start")
	}
	select {
	case <-tuiStarted:
	case <-time.After(250 * time.Millisecond):
		release()
		<-returned
		t.Fatal("TUI did not start while runtime preflight was blocked")
	}
	if err := <-returned; err != nil {
		t.Fatalf("execute dev: %v", err)
	}
}

func TestDevTUIStartsWhileInitialProjectIndexIsStillRunning(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	baselineStarted := make(chan struct{})
	releaseBaseline := make(chan struct{})
	indexer := blockingCommandProjectIndexer{started: baselineStarted, release: releaseBaseline}
	streams := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, interactiveDevTestIO())
	var startedAt time.Time
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning:    func(int) bool { return false },
		portAvailable:    func(int) bool { return true },
		runtimePreflight: func(context.Context, *output.IO) {},
		newServer: func(options server.DevServerOptions) devServerSession {
			options.ProjectIndexer = indexer
			options.RuntimeArtifacts = func(context.Context, string, []store.ProjectDefinition) error { return nil }
			options.ObservabilityDBPath = root + "/observability.sqlite"
			return &nativeDevServerSession{server: server.NewDevServer(options)}
		},
		runTUI: func(_ context.Context, _ *output.IO, _ devServerSession, _ string, _ int, _ *startupTracker, _ <-chan string, _ tui.BrowserOpener, shutdown func() error) error {
			if elapsed := time.Since(startedAt); elapsed > time.Second {
				t.Fatalf("TUI startup waited %s for initial Project Index", elapsed)
			}
			select {
			case <-baselineStarted:
			case <-time.After(time.Second):
				t.Fatal("initial Project Index did not start in the background")
			}
			close(releaseBaseline)
			return shutdown()
		},
	})
	cmd.SetArgs([]string{"--port", strconv.Itoa(port)})

	startedAt = time.Now()
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("execute dev: %v", err)
	}
	select {
	case <-baselineStarted:
	default:
		t.Fatal("initial Project Index did not run in the background")
	}
}

type blockingCommandProjectIndexer struct {
	started chan struct{}
	release chan struct{}
}

func (i blockingCommandProjectIndexer) IndexProjectAstPatch(ctx context.Context, root, _, _ string) (projectindex.IndexPatch, error) {
	close(i.started)
	select {
	case <-i.release:
	case <-ctx.Done():
		return projectindex.IndexPatch{}, ctx.Err()
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1, Phase: projectindex.PhaseAST, Project: store.ProjectIdentity{Root: root},
		Status: "ok", Invalidates: &projectindex.IndexPatchInvalidation{All: true},
	}, nil
}

func TestRuntimePreflightPreservesStructuredWorkerDiagnostic(t *testing.T) {
	oldRunner := runRuntimeOperationForCommand
	t.Cleanup(func() { runRuntimeOperationForCommand = oldRunner })
	runRuntimeOperationForCommand = func(context.Context, string, string, string, commandWorkerProcess) (json.RawMessage, error) {
		return nil, &eventwire.WorkerEventError{
			Scope: "artifact", Code: "RUNTIME_HOST_ONLY", Message: "crux setup requires the convex runtime host.",
			Remediation: "Wire the generated Convex runtime handlers.",
		}
	}

	streams := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{})
	diagnostics := printRuntimePreflight(context.Background(), streams, streams.Err, t.TempDir())
	if len(diagnostics) != 1 {
		t.Fatalf("diagnostics = %#v, want one", diagnostics)
	}
	got := diagnostics[0]
	if got.Code != "RUNTIME_HOST_ONLY" || got.Remediation != "Wire the generated Convex runtime handlers." {
		t.Fatalf("diagnostic = %#v, want structured code and remediation", got)
	}
}

func TestDevTUIReplaysTypedRuntimePreflightDiagnosticOnce(t *testing.T) {
	streams := output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, interactiveDevTestIO())
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning: func(int) bool { return false },
		portAvailable: func(int) bool { return true },
		runtimePreflightStatus: func(context.Context, *output.IO) []startup.Diagnostic {
			return []startup.Diagnostic{{
				ID: "runtime-preflight:RUNTIME_HOST_ONLY", Code: "RUNTIME_HOST_ONLY", Severity: "warning",
				Message: "Runtime setup requires the convex runtime host.", Remediation: "Generate the Convex runtime handlers.",
			}}
		},
		newServer: func(server.DevServerOptions) devServerSession { return &fakeDevServerSession{} },
		runTUI: func(ctx context.Context, _ *output.IO, _ devServerSession, _ string, _ int, tracker *startupTracker, _ <-chan string, _ tui.BrowserOpener, shutdown func() error) error {
			snapshot, updates := tracker.journal.SnapshotAndSubscribe(ctx)
			deadline := time.After(time.Second)
			for len(snapshot.Diagnostics) == 0 {
				select {
				case snapshot = <-updates:
				case <-deadline:
					t.Fatal("runtime preflight diagnostic was not replayed")
				}
			}
			if len(snapshot.Diagnostics) != 1 || snapshot.Diagnostics[0].Code != "RUNTIME_HOST_ONLY" {
				t.Fatalf("diagnostics = %#v, want one typed runtime-host-only diagnostic", snapshot.Diagnostics)
			}
			return shutdown()
		},
	})

	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("execute dev: %v", err)
	}
}

func TestDevPreflightReceivesCommandContextAndOwnedDiagnosticIO(t *testing.T) {
	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	root := context.WithValue(context.Background(), devPreflightContextKey{}, "root")
	observed := false
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning: func(int) bool { return true },
		runtimePreflight: func(ctx context.Context, io *output.IO) {
			observed = ctx.Value(devPreflightContextKey{}) == "root" &&
				io.In == streams.In && io.Out == streams.Out && io.Err != streams.Err
		},
	})

	if err := cmd.ExecuteContext(root); err != nil {
		t.Fatalf("execute dev: %v", err)
	}
	if !observed {
		t.Fatal("dev preflight did not receive command context and injected IO")
	}
}

func TestDevJoinsCanceledPreflightWithoutFlushingDiagnostics(t *testing.T) {
	var errOut bytes.Buffer
	streams := output.NewTestIO(&bytes.Buffer{}, &errOut, output.TestIOOptions{})
	preflightStarted := make(chan struct{})
	releasePreflight := make(chan struct{})
	preflightReturned := make(chan struct{})
	cmd := newDevCmd(cli.NewFactoryWithStreams(streams), devDependencies{
		serverRunning: func(int) bool { return true },
		runtimePreflight: func(_ context.Context, io *output.IO) {
			close(preflightStarted)
			<-releasePreflight // Deliberately ignore cancellation to exercise the strict join boundary.
			_, _ = io.Err.Write([]byte("late preflight diagnostic"))
			close(preflightReturned)
		},
	})

	returned := make(chan error, 1)
	go func() { returned <- cmd.ExecuteContext(context.Background()) }()
	select {
	case <-preflightStarted:
	case <-time.After(time.Second):
		t.Fatal("runtime preflight did not start")
	}
	select {
	case err := <-returned:
		t.Fatalf("dev returned before its admitted preflight worker: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(releasePreflight)
	select {
	case <-preflightReturned:
	case <-time.After(time.Second):
		t.Fatal("runtime preflight did not return after release")
	}
	if err := <-returned; err != nil {
		t.Fatalf("execute dev: %v", err)
	}
	if got := errOut.String(); strings.Contains(got, "late preflight diagnostic") {
		t.Fatalf("preflight wrote after command return: %q", got)
	}
}

func TestDevPreflightRetainsContextAndWritesDiagnosticsToErr(t *testing.T) {
	oldRunner := runRuntimeOperationForCommand
	defer func() { runRuntimeOperationForCommand = oldRunner }()

	root := context.WithValue(context.Background(), devPreflightContextKey{}, "root")
	ctx, cancel := context.WithCancel(root)
	cancel()
	observedContext := false
	runRuntimeOperationForCommand = func(got context.Context, _, operation, _ string, _ commandWorkerProcess) (json.RawMessage, error) {
		if operation != "preflight" {
			t.Fatalf("unexpected operation %q", operation)
		}
		observedContext = got.Value(devPreflightContextKey{}) == "root" && errors.Is(got.Err(), context.Canceled)
		return nil, errors.New("preflight broke")
	}

	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	printRuntimePreflight(ctx, streams, streams.Err, t.TempDir())

	if !observedContext {
		t.Fatal("runtime preflight did not retain the command context")
	}
	if out.Len() != 0 {
		t.Fatalf("runtime preflight wrote diagnostics to stdout: %q", out.String())
	}
	if diagnostic := errOut.String(); !strings.Contains(diagnostic, "Runtime preflight preflight failed") || !strings.Contains(diagnostic, "preflight broke") {
		t.Fatalf("runtime preflight stderr missing diagnostic: %q", diagnostic)
	}
}
