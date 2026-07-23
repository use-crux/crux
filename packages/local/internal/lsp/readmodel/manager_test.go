package readmodel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestManagerBoundsInitialWebSocketDiscovery(t *testing.T) {
	root := t.TempDir()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write(snapshotJSON(root, root+"/a.ts", "finding", 1))
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	manager := NewManager(ManagerOptions{
		ScopeID:       root,
		Root:          root,
		Version:       "v-test",
		Transport:     NewAttachTransport(api.New(server.URL)),
		InitialBudget: 20 * time.Millisecond,
		Connect: func(ctx context.Context, _ string) (MessageStream, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
		StartOwn: func(context.Context, OwnOptions) (OwnSource, error) {
			return newFakeOwnSource(Snapshot{}), nil
		},
	})
	done := make(chan struct{})
	go func() { defer close(done); manager.Run(ctx) }()
	waitFor(t, 100*time.Millisecond, func() bool { return manager.Mode() == ModeOwn })
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("unavailable manager did not stop")
	}
}
