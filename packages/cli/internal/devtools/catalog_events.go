package devtools

import (
	"context"
	"log/slog"
	"sync"

	"github.com/use-crux/crux/packages/cli/internal/store"
)

// CatalogEventBus is the in-process realtime stream for catalog changes.
// HTTP and WebSocket are adapters on top of this bus; native callers can
// subscribe directly without routing through the web server.
type CatalogEventBus struct {
	mu   sync.Mutex
	subs map[chan store.CatalogData]struct{}
}

func NewCatalogEventBus() *CatalogEventBus {
	return &CatalogEventBus{subs: make(map[chan store.CatalogData]struct{})}
}

func (b *CatalogEventBus) Subscribe(ctx context.Context) <-chan store.CatalogData {
	ch := make(chan store.CatalogData, 16)
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

func (b *CatalogEventBus) Publish(catalog store.CatalogData) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- catalog:
		default:
			slog.Debug("dropping catalog event for slow subscriber")
		}
	}
}
