package tui

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type shutdownProgramResult struct {
	model tea.Model
	err   error
}

func runShutdownTestProgram(t *testing.T, app *App, input string) <-chan shutdownProgramResult {
	t.Helper()

	program := tea.NewProgram(
		app,
		tea.WithInput(strings.NewReader(input)),
		tea.WithOutput(io.Discard),
		tea.WithEnvironment([]string{"NO_COLOR=1", "TERM=dumb"}),
		tea.WithWindowSize(80, 24),
		tea.WithoutSignalHandler(),
	)
	app.SetProgram(program)
	done := make(chan shutdownProgramResult, 1)
	go func() {
		model, err := program.Run()
		done <- shutdownProgramResult{model: model, err: err}
	}()
	return done
}

func newShutdownTestApp(ctx context.Context) *App {
	app := NewApp(ctx, "http://localhost:4400", programFixtureClient{uitest.NewFixtureClient()}, "", false)
	app.MarkBootComplete()
	return app
}

func TestAppRestoresTerminalBeforeWorkspaceCleanupCompletes(t *testing.T) {
	cleanupStarted := make(chan struct{})
	cleanupRelease := make(chan struct{})
	app := newShutdownTestApp(t.Context())
	app.SetShutdownCallback(func() error {
		close(cleanupStarted)
		<-cleanupRelease
		return nil
	})

	done := runShutdownTestProgram(t, app, "q")

	select {
	case <-cleanupStarted:
	case <-time.After(time.Second):
		t.Fatal("workspace q did not start cleanup")
	}
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("run program: %v", result.err)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("program kept the terminal open while cleanup was blocked")
	}

	close(cleanupRelease)
	result := app.FinishShutdown()
	if !result.Completed {
		t.Fatal("shutdown result was not marked complete")
	}
	if result.Cause != ShutdownClean {
		t.Fatalf("shutdown cause = %v, want clean", result.Cause)
	}
	if result.Err != nil {
		t.Fatalf("shutdown error = %v, want nil", result.Err)
	}
}

func TestAppRunsCleanupOnceAndIgnoresWorkAfterShutdownStarts(t *testing.T) {
	cleanupErr := errors.New("cleanup failed")
	cleanupStarted := make(chan struct{})
	cleanupRelease := make(chan struct{})
	var cleanupCalls atomic.Int32
	root, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()
	app := newShutdownTestApp(root)
	app.SetShutdownCallback(func() error {
		cleanupCalls.Add(1)
		close(cleanupStarted)
		<-cleanupRelease
		return cleanupErr
	})

	done := runShutdownTestProgram(t, app, "q")
	select {
	case <-cleanupStarted:
	case <-time.After(time.Second):
		t.Fatal("workspace q did not start cleanup")
	}

	cancelRoot()
	app.SendMsg(tea.KeyPressMsg(tea.Key{Code: 'c', Mod: tea.ModCtrl}))
	app.SetStartupSummary("late work")
	close(cleanupRelease)

	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("run program: %v", result.err)
		}
	case <-time.After(time.Second):
		t.Fatal("program did not quit after cleanup completed")
	}

	if calls := cleanupCalls.Load(); calls != 1 {
		t.Fatalf("cleanup calls = %d, want one", calls)
	}
	result := app.ShutdownResult()
	if result.Cause != ShutdownClean {
		t.Fatalf("shutdown cause = %v, want first clean request", result.Cause)
	}
	if !errors.Is(result.Err, cleanupErr) {
		t.Fatalf("shutdown error = %v, want %v", result.Err, cleanupErr)
	}
	if app.startupSummary != "" {
		t.Fatalf("startup summary accepted during shutdown: %q", app.startupSummary)
	}
}

func TestAppPaletteQuitAliasesUseTheSameCleanupPath(t *testing.T) {
	for _, command := range []string{"quit", "q", "exit"} {
		t.Run(command, func(t *testing.T) {
			cleanupCalled := make(chan struct{})
			app := newShutdownTestApp(t.Context())
			app.SetShutdownCallback(func() error {
				close(cleanupCalled)
				return nil
			})

			done := runShutdownTestProgram(t, app, ":"+command+"\r")
			select {
			case result := <-done:
				if result.err != nil {
					t.Fatalf("run program: %v", result.err)
				}
			// The aggregate race suite runs several render-heavy packages in
			// parallel; keep the deadline about deadlock detection, not CPU share.
			case <-time.After(5 * time.Second):
				t.Fatal("palette quit did not complete")
			}
			select {
			case <-cleanupCalled:
			default:
				t.Fatal("palette quit bypassed App cleanup")
			}
			if result := app.ShutdownResult(); result.Cause != ShutdownClean {
				t.Fatalf("shutdown cause = %v, want clean", result.Cause)
			}
		})
	}
}

func TestAppRootCancellationWaitsForCleanupBeforeQuitting(t *testing.T) {
	root, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()
	app := newShutdownTestApp(root)
	cleanupCalled := make(chan struct{})
	app.SetShutdownCallback(func() error {
		close(cleanupCalled)
		return nil
	})

	input, closeInput := io.Pipe()
	defer closeInput.Close()
	program := tea.NewProgram(
		app,
		tea.WithInput(input),
		tea.WithOutput(io.Discard),
		tea.WithEnvironment([]string{"NO_COLOR=1", "TERM=dumb"}),
		tea.WithWindowSize(80, 24),
		tea.WithoutSignalHandler(),
	)
	app.SetProgram(program)
	done := make(chan shutdownProgramResult, 1)
	go func() {
		model, err := program.Run()
		done <- shutdownProgramResult{model: model, err: err}
	}()

	cancelRoot()
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("run program: %v", result.err)
		}
	case <-time.After(time.Second):
		program.Kill()
		<-done
		t.Fatal("root cancellation did not request App shutdown")
	}

	select {
	case <-cleanupCalled:
	default:
		t.Fatal("root cancellation bypassed cleanup")
	}
	if result := app.ShutdownResult(); result.Cause != ShutdownContextCanceled {
		t.Fatalf("shutdown cause = %v, want context canceled", result.Cause)
	}
}

func TestAppRawCtrlCRecordsInterruptAfterCleanup(t *testing.T) {
	cleanupCalled := make(chan struct{})
	app := newShutdownTestApp(t.Context())
	app.SetShutdownCallback(func() error {
		close(cleanupCalled)
		return nil
	})

	done := runShutdownTestProgram(t, app, "\x03")
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("run program: %v", result.err)
		}
	case <-time.After(time.Second):
		t.Fatal("raw Ctrl+C did not complete")
	}
	select {
	case <-cleanupCalled:
	default:
		t.Fatal("raw Ctrl+C bypassed cleanup")
	}
	if result := app.ShutdownResult(); result.Cause != ShutdownRawInterrupt {
		t.Fatalf("shutdown cause = %v, want raw interrupt", result.Cause)
	}
}

func TestAppBootQuitUsesTheSameCleanupPath(t *testing.T) {
	cleanupCalled := make(chan struct{})
	app := NewApp(t.Context(), "http://localhost:4400", programFixtureClient{uitest.NewFixtureClient()}, "", false)
	app.SetShutdownCallback(func() error {
		close(cleanupCalled)
		return nil
	})

	done := runShutdownTestProgram(t, app, "q")
	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("run program: %v", result.err)
		}
	case <-time.After(time.Second):
		t.Fatal("boot q did not complete")
	}
	select {
	case <-cleanupCalled:
	default:
		t.Fatal("boot q bypassed cleanup")
	}
	if result := app.ShutdownResult(); result.Cause != ShutdownClean {
		t.Fatalf("shutdown cause = %v, want clean", result.Cause)
	}
}
