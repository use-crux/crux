package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestRunWithSignalHandlingReturnsZeroAfterCleanCompletion(t *testing.T) {
	var stderr bytes.Buffer
	notifier := newFakeSignalNotifier()

	code := runWithSignalHandling(context.Background(), &stderr, notifier, func(context.Context) error {
		return nil
	})

	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want empty", stderr.String())
	}
}

func TestRunWithSignalHandlingRetainsSIGINTAndCancelsRoot(t *testing.T) {
	var stderr bytes.Buffer
	notifier := newFakeSignalNotifier()

	code := runWithSignalHandling(context.Background(), &stderr, notifier, func(ctx context.Context) error {
		if err := notifier.Send(syscall.SIGINT); err != nil {
			return err
		}
		<-ctx.Done()
		return ctx.Err()
	})

	if code != 130 {
		t.Fatalf("exit code = %d, want 130", code)
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want expected cancellation to be silent", stderr.String())
	}
	if got := notifier.ResetSignals(); len(got) != 2 || got[0] != syscall.SIGINT || got[1] != syscall.SIGTERM {
		t.Fatalf("reset signals = %v, want [SIGINT SIGTERM]", got)
	}
}

func TestRunWithSignalHandlingKeepsSIGTERMStatusWhenCleanupFails(t *testing.T) {
	var stderr bytes.Buffer
	notifier := newFakeSignalNotifier()

	code := runWithSignalHandling(context.Background(), &stderr, notifier, func(ctx context.Context) error {
		if err := notifier.Send(syscall.SIGTERM); err != nil {
			return err
		}
		<-ctx.Done()
		return errors.New("cleanup failed")
	})

	if code != 143 {
		t.Fatalf("exit code = %d, want 143", code)
	}
	if got := stderr.String(); got != "cleanup failed\n" {
		t.Fatalf("stderr = %q, want cleanup failure", got)
	}
}

func TestRunWithSignalHandlingReportsJoinedCleanupErrorWithoutCancellationNoise(t *testing.T) {
	var stderr bytes.Buffer
	notifier := newFakeSignalNotifier()

	code := runWithSignalHandling(context.Background(), &stderr, notifier, func(ctx context.Context) error {
		if err := notifier.Send(syscall.SIGINT); err != nil {
			return err
		}
		<-ctx.Done()
		return errors.Join(ctx.Err(), errors.New("cleanup failed"))
	})

	if code != 130 {
		t.Fatalf("exit code = %d, want 130", code)
	}
	if got := stderr.String(); got != "cleanup failed\n" {
		t.Fatalf("stderr = %q, want only cleanup failure", got)
	}
}

func TestRunCLIReportsCommandErrorsThroughFactoryDiagnostics(t *testing.T) {
	var stdout, stderr bytes.Buffer
	streams := output.NewTestIO(&stdout, &stderr, output.TestIOOptions{})

	code := runCLI(
		context.Background(),
		cli.NewFactoryWithStreams(streams),
		newFakeSignalNotifier(),
		[]string{"not-a-command"},
	)

	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if got := stderr.String(); !strings.Contains(got, `unknown command "not-a-command"`) {
		t.Fatalf("stderr = %q, want unknown-command diagnostic", got)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", stdout.String())
	}
}

func TestRunWithSignalHandlingPreservesExplicitRawInterruptStatus(t *testing.T) {
	var stderr bytes.Buffer

	code := runWithSignalHandling(
		context.Background(),
		&stderr,
		newFakeSignalNotifier(),
		func(context.Context) error { return domain.ExitError{Code: 130} },
	)

	if code != 130 {
		t.Fatalf("exit code = %d, want 130", code)
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr = %q, want explicit interrupt to be silent", stderr.String())
	}
}

type fakeSignalNotifier struct {
	mu     sync.Mutex
	ch     chan<- os.Signal
	resets []os.Signal
}

func newFakeSignalNotifier() *fakeSignalNotifier { return &fakeSignalNotifier{} }

func (n *fakeSignalNotifier) Notify(ch chan<- os.Signal, _ ...os.Signal) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.ch = ch
}

func (n *fakeSignalNotifier) Stop(chan<- os.Signal) {}

func (n *fakeSignalNotifier) Reset(signals ...os.Signal) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.resets = append([]os.Signal(nil), signals...)
}

func (n *fakeSignalNotifier) Send(sig os.Signal) error {
	n.mu.Lock()
	ch := n.ch
	n.mu.Unlock()
	if ch == nil {
		return errors.New("signal channel was not registered")
	}
	ch <- sig
	return nil
}

func (n *fakeSignalNotifier) ResetSignals() []os.Signal {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]os.Signal(nil), n.resets...)
}
