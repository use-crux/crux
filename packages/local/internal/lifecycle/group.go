// Package lifecycle owns closeable goroutine admission for one command session.
package lifecycle

import (
	"context"
	"sync"
)

// Group admits workers until Close, then safely joins them without racing a
// late WaitGroup.Add.
type Group struct {
	mu     sync.Mutex
	closed bool
	wg     sync.WaitGroup
}

func (g *Group) Go(run func()) bool {
	if g == nil {
		go run()
		return true
	}
	g.mu.Lock()
	if g.closed {
		g.mu.Unlock()
		return false
	}
	g.wg.Add(1)
	g.mu.Unlock()
	go func() {
		defer g.wg.Done()
		run()
	}()
	return true
}

func (g *Group) Close() {
	if g == nil {
		return
	}
	g.mu.Lock()
	g.closed = true
	g.mu.Unlock()
}

func (g *Group) Wait(ctx context.Context) error {
	if g == nil {
		return nil
	}
	done := make(chan struct{})
	go func() {
		g.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
