package commands

import (
	"context"
	"sync"
	"time"
)

// shutdownCoordinator cancels one command-owned session and memoizes its
// bounded cleanup result. Concurrent normal, UI, and signal paths therefore
// observe the same terminal outcome without repeating side effects.
type shutdownCoordinator struct {
	cancel  context.CancelFunc
	timeout time.Duration
	cleanup func(context.Context) error

	once sync.Once
	err  error
}

func newShutdownCoordinator(cancel context.CancelFunc, timeout time.Duration, cleanup func(context.Context) error) *shutdownCoordinator {
	return &shutdownCoordinator{cancel: cancel, timeout: timeout, cleanup: cleanup}
}

// Shutdown cancels child work, runs cleanup once with a fresh bounded context,
// and returns the cached result to every caller.
func (coordinator *shutdownCoordinator) Shutdown() error {
	coordinator.once.Do(func() {
		if coordinator.cancel != nil {
			coordinator.cancel()
		}
		if coordinator.cleanup == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), coordinator.timeout)
		defer cancel()
		result := make(chan error, 1)
		go func() { result <- coordinator.cleanup(ctx) }()
		select {
		case coordinator.err = <-result:
		case <-ctx.Done():
			coordinator.err = ctx.Err()
		}
	})
	return coordinator.err
}
