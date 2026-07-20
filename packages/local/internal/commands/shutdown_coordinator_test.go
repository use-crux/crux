package commands

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestShutdownCoordinatorCancelsChildrenAndCleansUpExactlyOnce(t *testing.T) {
	sessionCtx, cancel := context.WithCancel(context.Background())
	want := errors.New("cleanup failed")
	var calls atomic.Int32
	coordinator := newShutdownCoordinator(cancel, time.Second, func(context.Context) error {
		calls.Add(1)
		return want
	})

	const callers = 12
	results := make(chan error, callers)
	var group sync.WaitGroup
	for range callers {
		group.Add(1)
		go func() {
			defer group.Done()
			results <- coordinator.Shutdown()
		}()
	}
	group.Wait()
	close(results)

	if sessionCtx.Err() != context.Canceled {
		t.Fatalf("session context error = %v, want canceled", sessionCtx.Err())
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("cleanup calls = %d, want 1", got)
	}
	for err := range results {
		if !errors.Is(err, want) {
			t.Fatalf("shutdown error = %v, want %v", err, want)
		}
	}
}

func TestShutdownCoordinatorBoundsCleanupThatIgnoresItsContext(t *testing.T) {
	coordinator := newShutdownCoordinator(func() {}, 20*time.Millisecond, func(context.Context) error {
		time.Sleep(150 * time.Millisecond)
		return nil
	})

	started := time.Now()
	err := coordinator.Shutdown()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("shutdown error = %v, want deadline exceeded", err)
	}
	if elapsed := time.Since(started); elapsed > 100*time.Millisecond {
		t.Fatalf("shutdown took %v, want bounded completion", elapsed)
	}
}
