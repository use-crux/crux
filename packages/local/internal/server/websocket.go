package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// upgrader rejects cross-origin WebSocket handshakes from untrusted origins.
// Browsers always send an Origin header; the devtools UI handshake carries the
// server's own origin (loopback or the tunnel host), so it is accepted, while a
// malicious website opening a socket to localhost is refused. Non-browser
// runtime peers send no Origin and are allowed.
var upgrader = websocket.Upgrader{
	CheckOrigin: originAllowed,
}

// WSHub manages WebSocket client connections and broadcasts.
type WSHub struct {
	mu                  sync.Mutex
	clients             map[*wsClient]struct{}
	ctx                 context.Context
	devtools            *devtools.Service
	inspectEvents       *inspect.EventBus
	observabilityEvents *observability.EventBus
	runtimeBridge       *runtimebridge.Service
	indexMu             sync.Mutex
	lastIndex           store.IndexData
	hasLastIndex        bool
	indexGeneration     uint64
}

// NewWSHub creates a WebSocket hub for the given store.
func NewWSHub(ctx context.Context, devtoolsSvc *devtools.Service, inspectEvents *inspect.EventBus, observabilityEvents *observability.EventBus, runtimeBridge *runtimebridge.Service) *WSHub {
	h := &WSHub{
		clients:       make(map[*wsClient]struct{}),
		ctx:           ctx,
		devtools:      devtoolsSvc,
		runtimeBridge: runtimeBridge,
	}
	if inspectEvents != nil {
		h.inspectEvents = inspectEvents
		go h.forwardInspectEvents(inspectEvents.Subscribe(ctx))
	}
	if observabilityEvents != nil {
		h.observabilityEvents = observabilityEvents
		go h.forwardObservabilityEvents(observabilityEvents.Subscribe(ctx))
	}
	if devtoolsSvc != nil && devtoolsSvc.IndexEvents() != nil {
		h.rememberIndex(devtoolsSvc.ProjectIndexSnapshot())
		go h.forwardIndexEvents(devtoolsSvc.IndexEvents().Subscribe(ctx))
	}
	if runtimeBridge != nil {
		go h.forwardRuntimeBridgeEvents(runtimeBridge.Subscribe(ctx))
	}
	return h
}

// HandleUpgrade is the HTTP handler for WebSocket upgrade requests.
func (h *WSHub) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}

	client := newWSClient(h, conn)
	h.mu.Lock()
	h.clients[client] = struct{}{}
	clientCount := len(h.clients)
	h.mu.Unlock()

	go client.writePump()

	// Register before the snapshot so a caller that mutates immediately after
	// receiving the snapshot cannot miss the live event.
	h.sendSnapshot(client)

	slog.Info("websocket client connected", "clients", clientCount)

	// Read pump — just drain messages (we don't expect client→server messages)
	go func() {
		defer func() {
			remaining := client.close()
			slog.Info("websocket client disconnected", "clients", remaining)
		}()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

// Broadcast sends raw JSON to all connected WebSocket clients.
func (h *WSHub) Broadcast(data []byte) {
	clients := h.snapshotClients()
	for _, client := range clients {
		client.enqueue(data)
	}
}

func (h *WSHub) snapshotClients() []*wsClient {
	h.mu.Lock()
	defer h.mu.Unlock()

	clients := make([]*wsClient, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	return clients
}

func (h *WSHub) removeClient(client *wsClient) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, client)
	return len(h.clients)
}

// BroadcastJSON sends a marshaled JSON event to all connected clients.
func (h *WSHub) BroadcastJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		slog.Error("websocket marshal failed", "error", err)
		return
	}
	h.Broadcast(data)
}

// ClientCount returns the number of connected WebSocket clients.
func (h *WSHub) ClientCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.clients)
}

func (h *WSHub) forwardInspectEvents(events <-chan api.InspectEvent) {
	for event := range events {
		h.BroadcastJSON(map[string]any{
			"type":      "inspect:event",
			"_tag":      event.Tag,
			"id":        event.ID,
			"timestamp": event.Timestamp,
			"kind":      event.Kind,
			"action":    event.Action,
			"severity":  event.Severity,
			"refId":     event.RefID,
			"payload":   event.Payload,
			"event":     event,
		})
	}
}

func (h *WSHub) forwardObservabilityEvents(events <-chan observability.Event) {
	for event := range events {
		h.BroadcastJSON(map[string]any{
			"type":  "observability:event",
			"event": event,
		})
		for _, msg := range endpoints.Registry.InvalidationMessages(event) {
			h.BroadcastJSON(msg)
		}
	}
}

func (h *WSHub) forwardIndexEvents(events <-chan store.IndexData) {
	for index := range events {
		for _, message := range h.indexUpdateMessages(index) {
			h.BroadcastJSON(message)
		}
	}
}

func (h *WSHub) forwardRuntimeBridgeEvents(events <-chan runtimebridge.Event) {
	for event := range events {
		h.BroadcastJSON(map[string]any{
			"type":  "runtime_bridge:event",
			"event": event,
		})
		if event.Action == "peer.connected" || event.Action == "peer.disconnected" {
			h.BroadcastJSON(map[string]any{
				"type":  "runtime_bridge.capabilities_changed",
				"event": event,
			})
			h.BroadcastJSON(map[string]any{
				"type":  "resource_inspection.changed",
				"event": event,
			})
		}
	}
}
