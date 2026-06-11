package devtools

import (
	"context"
	"log/slog"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// IndexEventBus is the in-process realtime stream for index changes.
// HTTP and WebSocket are adapters on top of this bus; native callers can
// subscribe directly without routing through the web server.
type IndexEventBus struct {
	mu   sync.Mutex
	subs map[chan store.IndexData]struct{}
}

func NewIndexEventBus() *IndexEventBus {
	return &IndexEventBus{subs: make(map[chan store.IndexData]struct{})}
}

func (b *IndexEventBus) Subscribe(ctx context.Context) <-chan store.IndexData {
	ch := make(chan store.IndexData, 16)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()

	go func() {
		<-ctx.Done()
		b.mu.Lock()
		delete(b.subs, ch)
		close(ch)
		b.mu.Unlock()
	}()

	return ch
}

func (b *IndexEventBus) Publish(index store.IndexData) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- index:
		default:
			slog.Debug("dropping index event for slow subscriber")
		}
	}
}
