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
	cancel              context.CancelFunc
	closed              bool
	closeOnce           sync.Once
	closeDone           chan struct{}
	workers             sync.WaitGroup
	devtools            *devtools.Service
	inspectEvents       *inspect.EventBus
	observabilityEvents *observability.EventBus
	runtimeBridge       *runtimebridge.Service
	logger              *slog.Logger
	indexMu             sync.Mutex
	lastIndex           store.IndexData
	hasLastIndex        bool
	indexGeneration     uint64
	projectRoot         string
	serverVersion       string
}

// IndexSnapshotOptions identifies Project Index snapshots served during this
// hub process. These values describe process/session identity, not cached index
// content.
type IndexSnapshotOptions struct {
	// ProjectRoot is the absolute root represented by Project Index snapshots.
	ProjectRoot string
	// ServerVersion is the explicit Cobra version of the running Crux server.
	ServerVersion string
}

// NewWSHub creates a WebSocket hub and routes its diagnostics to logger.
func NewWSHub(ctx context.Context, devtoolsSvc *devtools.Service, inspectEvents *inspect.EventBus, observabilityEvents *observability.EventBus, runtimeBridge *runtimebridge.Service, logger *slog.Logger, indexOptions IndexSnapshotOptions) *WSHub {
	if ctx == nil {
		ctx = context.Background()
	}
	hubCtx, cancel := context.WithCancel(ctx)
	if logger == nil {
		logger = slog.Default()
	}
	h := &WSHub{
		clients:       make(map[*wsClient]struct{}),
		ctx:           hubCtx,
		cancel:        cancel,
		closeDone:     make(chan struct{}),
		devtools:      devtoolsSvc,
		runtimeBridge: runtimeBridge,
		logger:        logger,
		projectRoot:   indexOptions.ProjectRoot,
		serverVersion: indexOptions.ServerVersion,
	}
	if inspectEvents != nil {
		h.inspectEvents = inspectEvents
		h.startWorker(func() { h.forwardInspectEvents(inspectEvents.Subscribe(hubCtx)) })
	}
	if observabilityEvents != nil {
		h.observabilityEvents = observabilityEvents
		h.startWorker(func() { h.forwardObservabilityEvents(observabilityEvents.Subscribe(hubCtx)) })
	}
	if devtoolsSvc != nil && devtoolsSvc.IndexEvents() != nil {
		h.startWorker(func() { h.forwardIndexEvents(devtoolsSvc.IndexEvents().Subscribe(hubCtx)) })
	}
	if runtimeBridge != nil {
		h.startWorker(func() { h.forwardRuntimeBridgeEvents(runtimeBridge.Subscribe(hubCtx)) })
	}
	h.startWorker(func() {
		<-hubCtx.Done()
		h.initiateClose()
	})
	return h
}

// HandleUpgrade is the HTTP handler for WebSocket upgrade requests.
func (h *WSHub) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log().Error("websocket upgrade failed", "error", err)
		return
	}

	client := newWSClient(h, conn)
	clientCount, registered := h.registerClientAndSendSnapshot(client)
	if !registered {
		_ = conn.Close()
		return
	}

	go func() {
		defer h.workers.Done()
		client.writePump()
	}()

	h.log().Info("websocket client connected", "clients", clientCount)

	// Read pump — just drain messages (we don't expect client→server messages)
	go func() {
		defer h.workers.Done()
		defer func() {
			remaining := client.close()
			h.log().Info("websocket client disconnected", "clients", remaining)
		}()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

func (h *WSHub) registerClientAndSendSnapshot(client *wsClient) (int, bool) {
	// Queue the coherent snapshot before making the client visible to any
	// broadcast. Holding indexMu prevents an index update from overtaking the
	// snapshot. Reserve both connection pumps before releasing mu so shutdown
	// cannot begin waiting while registration is still in flight.
	h.indexMu.Lock()
	defer h.indexMu.Unlock()
	h.mu.Lock()
	if h.closed {
		clientCount := len(h.clients)
		h.mu.Unlock()
		return clientCount, false
	}
	h.workers.Add(2)
	h.mu.Unlock()

	h.sendSnapshotLocked(client)
	h.mu.Lock()
	defer h.mu.Unlock()
	select {
	case <-client.done:
		h.workers.Done()
		h.workers.Done()
		return len(h.clients), false
	default:
	}
	if h.closed {
		h.workers.Done()
		h.workers.Done()
		return len(h.clients), false
	}
	h.clients[client] = struct{}{}
	return len(h.clients), true
}

func (h *WSHub) startWorker(run func()) {
	h.workers.Add(1)
	go func() {
		defer h.workers.Done()
		run()
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
		h.log().Error("websocket marshal failed", "error", err)
		return
	}
	h.Broadcast(data)
}

func (h *WSHub) log() *slog.Logger {
	if h.logger != nil {
		return h.logger
	}
	return slog.Default()
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
