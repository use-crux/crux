package bridge

import (
	"context"
	"encoding/json"
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
	Quality       <-chan api.QualityEvent
	StoreChanged  <-chan struct{}
	IndexChanged  <-chan store.IndexData
	Observability <-chan observability.Event
	Clock         Clock
}

// Batch is the single Bubble Tea message emitted by the bridge.
type Batch struct {
	Quality      []api.QualityEvent
	StoreChanged bool
	IndexChanged bool
	Revs         Revisions
	Changed      Domains
}

type item struct {
	quality      *api.QualityEvent
	storeChanged bool
	indexChanged bool
}

// Start drains every source bus into one coalescing collector and sends
// revision-tagged batches into Bubble Tea. The first event after a quiet period
// is delivered immediately; follow-up events are batched on an 80ms window.
func Start(ctx context.Context, src Sources, send func(tea.Msg)) {
	clock := src.Clock
	if clock == nil {
		clock = realClock{}
	}
	in := make(chan item, 256)
	startDrains(ctx, src, in)
	go collect(ctx, clock, in, send)
}

func startDrains(ctx context.Context, src Sources, in chan<- item) {
	if src.Quality != nil {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case ev, ok := <-src.Quality:
					if !ok {
						return
					}
					forward(ctx, in, item{quality: &ev})
				}
			}
		}()
	}
	if src.StoreChanged != nil {
		go func() {
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
		}()
	}
	if src.IndexChanged != nil {
		go func() {
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
		}()
	}
	if src.Observability != nil {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case ev, ok := <-src.Observability:
					if !ok {
						return
					}
					qev := qualityEventFromObservability(ev)
					forward(ctx, in, item{quality: &qev})
				}
			}
		}()
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
	return len(p.batch.Quality) == 0 && !p.batch.StoreChanged && !p.batch.IndexChanged
}

func (p *pendingBatch) add(it item, revs *Revisions) {
	batch := batchOf(it, revs)
	if p.batch.Changed == nil {
		p.batch.Changed = NewDomains()
	}
	p.batch.StoreChanged = p.batch.StoreChanged || batch.StoreChanged
	p.batch.IndexChanged = p.batch.IndexChanged || batch.IndexChanged
	p.batch.Changed.AddAll(batch.Changed)
	for _, ev := range batch.Quality {
		key := ev.Kind + "\x00" + ev.Action + "\x00" + ev.RefID
		if index, ok := p.seen[key]; ok {
			p.batch.Quality[index] = ev
			continue
		}
		p.seen[key] = len(p.batch.Quality)
		p.batch.Quality = append(p.batch.Quality, ev)
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
	if it.quality != nil {
		batch.Quality = append(batch.Quality, *it.quality)
		batch.Changed.AddAll(revs.BumpQuality(*it.quality))
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

func qualityEventFromObservability(ev observability.Event) api.QualityEvent {
	payload := ev.Payload
	if len(payload) == 0 {
		payload, _ = json.Marshal(ev)
	}
	return api.QualityEvent{
		Tag:       "QualityEvent",
		ID:        ev.ID,
		Timestamp: ev.Timestamp,
		Kind:      "observability",
		Action:    ev.Action,
		Severity:  ev.Severity,
		RefID:     ev.RefID,
		Payload:   payload,
	}
}
