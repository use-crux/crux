package bridge

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestStartCoalescesBurstWithFakeClock(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	quality := make(chan api.QualityEvent, 1100)
	for i := 0; i < 1000; i++ {
		quality <- api.QualityEvent{Kind: "run", Action: "changed", RefID: fmt.Sprintf("run-%d", i)}
	}

	clock := newFakeClock()
	delivered := make(chan Batch, 10)
	Start(ctx, Sources{Quality: quality, Clock: clock}, func(msg tea.Msg) {
		delivered <- msg.(Batch)
	})

	first := waitBatch(t, delivered)
	if len(first.Quality) != 1 {
		t.Fatalf("first batch quality events = %d, want 1", len(first.Quality))
	}
	if first.Revs.Runs != 1 {
		t.Fatalf("first runs revision = %d, want 1", first.Revs.Runs)
	}

	// Items flow source → drain goroutine → internal buffer → collector, so
	// the collector may still be ingesting when the source channel reads
	// empty. Drive the fake clock until every event has been delivered
	// instead of assuming one window catches the whole burst.
	received := len(first.Quality)
	sends := 1
	var last Batch
	deadline := time.Now().Add(5 * time.Second)
	for received < 1000 {
		if time.Now().After(deadline) {
			t.Fatalf("timed out: received %d of 1000 events in %d sends", received, sends)
		}
		clock.Advance()
		select {
		case b := <-delivered:
			received += len(b.Quality)
			sends++
			last = b
		case <-time.After(5 * time.Millisecond):
			// Timer fired with an empty pending batch (collector had not
			// ingested the next items yet) — no send is correct; loop.
		}
	}
	if received != 1000 {
		t.Fatalf("received = %d events, want 1000 (zero dropped)", received)
	}
	if last.Revs.Runs != 1000 {
		t.Fatalf("final runs revision = %d, want 1000", last.Revs.Runs)
	}
	// The real acceptance is coalescing: a 1000-event burst must never
	// approach per-event delivery. The absolute send count is an artifact
	// of how fast this test advances the fake clock (each Advance closes a
	// window), so assert a coalescing ratio rather than a fixed count.
	if sends > 100 {
		t.Fatalf("burst delivered in %d sends for %d events; want >=10x coalescing", sends, received)
	}
}

func TestStartDeduplicatesQualityEventsWithinTrailingBatch(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	quality := make(chan api.QualityEvent, 4)
	clock := newFakeClock()
	delivered := make(chan Batch, 10)
	Start(ctx, Sources{Quality: quality, Clock: clock}, func(msg tea.Msg) {
		delivered <- msg.(Batch)
	})

	quality <- api.QualityEvent{Kind: "run", Action: "changed", RefID: "trace-1"}
	waitBatch(t, delivered)
	quality <- api.QualityEvent{Kind: "run", Action: "changed", RefID: "trace-2"}
	quality <- api.QualityEvent{Kind: "run", Action: "changed", RefID: "trace-2"}

	// Both trace-2 events may land in one trailing batch (deduped to one
	// row) or split across windows depending on ingestion timing. The
	// stable invariants: no batch ever contains a duplicate
	// (kind,action,ref) row, and revisions count all three source events.
	var revs Revisions
	deadline := time.Now().Add(5 * time.Second)
	for revs.Runs < 3 {
		if time.Now().After(deadline) {
			t.Fatalf("timed out: runs revision = %d, want 3", revs.Runs)
		}
		clock.Advance()
		select {
		case b := <-delivered:
			seen := map[string]bool{}
			for _, ev := range b.Quality {
				key := ev.Kind + "\x00" + ev.Action + "\x00" + ev.RefID
				if seen[key] {
					t.Fatalf("batch contains duplicate event row %q: %#v", key, b.Quality)
				}
				seen[key] = true
			}
			revs = b.Revs
		case <-time.After(5 * time.Millisecond):
		}
	}
	if revs.Runs != 3 {
		t.Fatalf("runs revision = %d, want 3; revisions count source changes, not deduped rows", revs.Runs)
	}
}

type fakeClock struct {
	mu     sync.Mutex
	timers []chan time.Time
}

func newFakeClock() *fakeClock { return &fakeClock{} }

func (c *fakeClock) After(time.Duration) <-chan time.Time {
	ch := make(chan time.Time, 1)
	c.mu.Lock()
	c.timers = append(c.timers, ch)
	c.mu.Unlock()
	return ch
}

func (c *fakeClock) Advance() {
	c.mu.Lock()
	if len(c.timers) == 0 {
		c.mu.Unlock()
		return
	}
	ch := c.timers[0]
	c.timers = c.timers[1:]
	c.mu.Unlock()
	ch <- time.Now()
}

func waitBatch(t *testing.T, ch <-chan Batch) Batch {
	t.Helper()
	select {
	case batch := <-ch:
		return batch
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for bridge batch")
		return Batch{}
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition was not met")
}
