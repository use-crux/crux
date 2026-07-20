package bridge

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

const coalesceWindow = 80 * time.Millisecond

// Clock supplies timers to the bridge collector. Tests inject a fake clock so
// the leading/trailing-edge throttle can be verified without sleeping.
type Clock interface {
	After(time.Duration) <-chan time.Time
}

type realClock struct{}

func (realClock) After(d time.Duration) <-chan time.Time { return time.After(d) }

// Sources groups the in-process event streams consumed by the TUI bridge.
type Sources struct {
	Inspect       <-chan api.InspectEvent
	StoreChanged  <-chan struct{}
	IndexChanged  <-chan store.IndexData
	Observability <-chan observability.Event
	Clock         Clock
}

// Batch is the single Bubble Tea message emitted by the bridge.
type Batch struct {
	Inspect      []api.InspectEvent
	StoreChanged bool
	IndexChanged bool
	Revs         Revisions
	Changed      Domains
}

type item struct {
	inspect      *api.InspectEvent
	storeChanged bool
	indexChanged bool
}

// Session owns the goroutines draining and coalescing one bridge source set.
type Session struct {
	workers sync.WaitGroup
}

func (session *Session) goRun(run func()) {
	session.workers.Add(1)
	go func() {
		defer session.workers.Done()
		run()
	}()
}

// Wait joins every collector and drain after its context is canceled.
func (session *Session) Wait(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		session.workers.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Start drains every source bus into one coalescing collector and sends
// revision-tagged batches into Bubble Tea. The first event after a quiet period
// is delivered immediately; follow-up events are batched on an 80ms window.
func Start(ctx context.Context, src Sources, send func(tea.Msg)) *Session {
	clock := src.Clock
	if clock == nil {
		clock = realClock{}
	}
	in := make(chan item, 256)
	session := &Session{}
	startDrains(ctx, src, in, session)
	session.goRun(func() { collect(ctx, clock, in, send) })
	return session
}

func startDrains(ctx context.Context, src Sources, in chan<- item, session *Session) {
	if src.Inspect != nil {
		session.goRun(func() {
			for {
				select {
				case <-ctx.Done():
					return
				case ev, ok := <-src.Inspect:
					if !ok {
						return
					}
					forward(ctx, in, item{inspect: &ev})
				}
			}
		})
	}
	if src.StoreChanged != nil {
		session.goRun(func() {
			for {
				select {
				case <-ctx.Done():
					return
				case _, ok := <-src.StoreChanged:
					if !ok {
						return
					}
					forward(ctx, in, item{storeChanged: true})
				}
			}
		})
	}
	if src.IndexChanged != nil {
		session.goRun(func() {
			for {
				select {
				case <-ctx.Done():
					return
				case _, ok := <-src.IndexChanged:
					if !ok {
						return
					}
					forward(ctx, in, item{indexChanged: true})
				}
			}
		})
	}
	if src.Observability != nil {
		session.goRun(func() {
			for {
				select {
				case <-ctx.Done():
					return
				case ev, ok := <-src.Observability:
					if !ok {
						return
					}
					inspectEvent := inspectEventFromObservability(ev)
					forward(ctx, in, item{inspect: &inspectEvent})
				}
			}
		})
	}
}

func forward(ctx context.Context, in chan<- item, it item) {
	select {
	case <-ctx.Done():
	case in <- it:
	}
}

func collect(ctx context.Context, clock Clock, in <-chan item, send func(tea.Msg)) {
	var revs Revisions
	pending := newPendingBatch()
	timerRunning := false
	var timer <-chan time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case it := <-in:
			if pending.empty() && !timerRunning {
				send(batchOf(it, &revs))
				timer = clock.After(coalesceWindow)
				timerRunning = true
				continue
			}
			pending.add(it, &revs)
		case <-timer:
			if !pending.empty() {
				send(pending.drain(revs))
				timer = clock.After(coalesceWindow)
				continue
			}
			timerRunning = false
			timer = nil
		}
	}
}

type pendingBatch struct {
	batch Batch
	seen  map[string]int
}

func newPendingBatch() *pendingBatch {
	return &pendingBatch{seen: map[string]int{}}
}

func (p *pendingBatch) empty() bool {
	return len(p.batch.Inspect) == 0 && !p.batch.StoreChanged && !p.batch.IndexChanged
}

func (p *pendingBatch) add(it item, revs *Revisions) {
	batch := batchOf(it, revs)
	if p.batch.Changed == nil {
		p.batch.Changed = NewDomains()
	}
	p.batch.StoreChanged = p.batch.StoreChanged || batch.StoreChanged
	p.batch.IndexChanged = p.batch.IndexChanged || batch.IndexChanged
	p.batch.Changed.AddAll(batch.Changed)
	for _, ev := range batch.Inspect {
		key := ev.Kind + "\x00" + ev.Action + "\x00" + ev.RefID
		if index, ok := p.seen[key]; ok {
			p.batch.Inspect[index] = ev
			continue
		}
		p.seen[key] = len(p.batch.Inspect)
		p.batch.Inspect = append(p.batch.Inspect, ev)
	}
}

func (p *pendingBatch) drain(revs Revisions) Batch {
	out := p.batch
	out.Revs = revs
	p.batch = Batch{}
	p.seen = map[string]int{}
	return out
}

func batchOf(it item, revs *Revisions) Batch {
	batch := Batch{Changed: NewDomains()}
	if it.inspect != nil {
		batch.Inspect = append(batch.Inspect, *it.inspect)
		batch.Changed.AddAll(revs.BumpInspect(*it.inspect))
	}
	if it.storeChanged {
		batch.StoreChanged = true
		batch.Changed.AddAll(revs.BumpStore())
	}
	if it.indexChanged {
		batch.IndexChanged = true
		batch.Changed.AddAll(revs.BumpIndex())
	}
	batch.Revs = *revs
	return batch
}

func inspectEventFromObservability(ev observability.Event) api.InspectEvent {
	payload := ev.Payload
	if len(payload) == 0 {
		payload, _ = json.Marshal(ev)
	}
	return api.InspectEvent{
		Tag:       "InspectEvent",
		ID:        ev.ID,
		Timestamp: ev.Timestamp,
		Kind:      "observability",
		Action:    ev.Action,
		Severity:  ev.Severity,
		RefID:     ev.RefID,
		Payload:   payload,
	}
}
