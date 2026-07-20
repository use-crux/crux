package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWSHubCloseDisconnectsActiveClientsAndWaitsForPumps(t *testing.T) {
	storage := store.NewStore()
	inspectSvc := inspect.NewService(storage, inspect.Dir(t.TempDir()))
	devtoolsSvc := devtools.NewService(storage, inspectSvc)
	t.Cleanup(devtoolsSvc.Shutdown)
	hub := NewWSHub(context.Background(), devtoolsSvc, nil, nil, nil, nil)
	ts := httptest.NewServer(httpHandler(hub.HandleUpgrade))
	t.Cleanup(ts.Close)
	client := dialWS(t, ts)

	waitForClientCount(t, hub, 1)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := hub.Close(ctx); err != nil {
		t.Fatalf("Close() error: %v", err)
	}
	if got := hub.ClientCount(); got != 0 {
		t.Fatalf("client count after Close = %d, want 0", got)
	}
	client.SetReadDeadline(time.Now().Add(time.Second))
	assertWebSocketClosed(t, client)
}

func TestWSHubParentCancellationDisconnectsActiveClients(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	hub, ts, client := newLiveTestWSHub(t, parent)
	waitForClientCount(t, hub, 1)

	cancel()
	client.SetReadDeadline(time.Now().Add(time.Second))
	assertWebSocketClosed(t, client)
	ctx, closeCancel := context.WithTimeout(context.Background(), time.Second)
	defer closeCancel()
	if err := hub.Close(ctx); err != nil {
		t.Fatalf("wait for parent-driven Close: %v", err)
	}
	ts.Close()
}

func newLiveTestWSHub(t *testing.T, ctx context.Context) (*WSHub, *httptest.Server, *websocket.Conn) {
	t.Helper()
	storage := store.NewStore()
	inspectSvc := inspect.NewService(storage, inspect.Dir(t.TempDir()))
	devtoolsSvc := devtools.NewService(storage, inspectSvc)
	t.Cleanup(devtoolsSvc.Shutdown)
	hub := NewWSHub(ctx, devtoolsSvc, nil, nil, nil, nil)
	ts := httptest.NewServer(httpHandler(hub.HandleUpgrade))
	t.Cleanup(ts.Close)
	client := dialWS(t, ts)
	t.Cleanup(func() { _ = client.Close() })
	return hub, ts, client
}

func httpHandler(handle func(http.ResponseWriter, *http.Request)) http.Handler {
	return http.HandlerFunc(handle)
}

func waitForClientCount(t *testing.T, hub *WSHub, want int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if hub.ClientCount() == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("client count = %d, want %d", hub.ClientCount(), want)
}

func assertWebSocketClosed(t *testing.T, client *websocket.Conn) {
	t.Helper()
	for {
		if _, _, err := client.ReadMessage(); err != nil {
			return
		}
	}
}
