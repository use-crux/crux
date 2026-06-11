package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"reflect"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
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
	clients             map[*websocket.Conn]bool
	ctx                 context.Context
	devtools            *devtools.Service
	qualityEvents       *quality.EventBus
	observabilityEvents *observability.EventBus
	runtimeBridge       *runtimebridge.Service
}

// NewWSHub creates a WebSocket hub for the given store.
func NewWSHub(ctx context.Context, devtoolsSvc *devtools.Service, qualityEvents *quality.EventBus, observabilityEvents *observability.EventBus, runtimeBridge *runtimebridge.Service) *WSHub {
	h := &WSHub{
		clients:       make(map[*websocket.Conn]bool),
		ctx:           ctx,
		devtools:      devtoolsSvc,
		runtimeBridge: runtimeBridge,
	}
	if qualityEvents != nil {
		h.qualityEvents = qualityEvents
		go h.forwardQualityEvents(qualityEvents.Subscribe(ctx))
	}
	if observabilityEvents != nil {
		h.observabilityEvents = observabilityEvents
		go h.forwardObservabilityEvents(observabilityEvents.Subscribe(ctx))
	}
	if devtoolsSvc != nil && devtoolsSvc.IndexEvents() != nil {
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

	h.mu.Lock()
	h.clients[conn] = true
	clientCount := len(h.clients)
	h.mu.Unlock()

	// Register before the snapshot so a caller that mutates immediately after
	// receiving the snapshot cannot miss the live event.
	h.sendSnapshot(conn)

	slog.Info("websocket client connected", "clients", clientCount)

	// Read pump — just drain messages (we don't expect client→server messages)
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.clients, conn)
			remaining := len(h.clients)
			h.mu.Unlock()
			conn.Close()
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
	h.mu.Lock()
	defer h.mu.Unlock()

	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			slog.Debug("websocket write failed, removing client", "error", err)
			conn.Close()
			delete(h.clients, conn)
		}
	}
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

func (h *WSHub) forwardQualityEvents(events <-chan api.QualityEvent) {
	for event := range events {
		h.BroadcastJSON(map[string]any{
			"type":      "quality:event",
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
		h.BroadcastJSON(indexMessage(index))
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

// sendSnapshot sends the full store state to a newly connected client.
// Sends multiple separate messages matching the Node.js server format
// expected by the UI reducer (index, snapshot, eval:snapshot, etc.).
func (h *WSHub) sendSnapshot(conn *websocket.Conn) {
	// Index — always send, even if empty. The UI needs the index
	// message to set indexReceived=true and exit the "Waiting" screen.
	if !h.sendRegisteredIndexSnapshot(conn) {
		h.sendJSON(conn, apiIndexMessage(api.IndexData{}))
	}

	// Eval runs
	if message, ok := registeredSnapshotMessage(h, "eval:snapshot"); ok {
		h.sendJSON(conn, message)
	}

	if message, ok := registeredSnapshotMessage(h, "rag-eval:snapshot"); ok {
		h.sendJSON(conn, message)
	}

	// Flow runs
	if message, ok := registeredSnapshotMessage(h, "flow:snapshot"); ok {
		h.sendJSON(conn, message)
	}

	// Runtime events
	if message, ok := registeredSnapshotMessage(h, "runtime:snapshot"); ok {
		message["memoryEvents"] = []any{}
		h.sendJSON(conn, message)
	}
}

func registeredSnapshotMessage(h *WSHub, message string) (map[string]any, bool) {
	out := map[string]any{"type": message}
	hasPayload := false
	for _, snapshot := range endpoints.Registry.SnapshotValues(context.Background(), endpoints.Deps{Devtools: h.devtools}, message) {
		if snapshot.Spec.Field == "" {
			continue
		}
		if snapshot.Err != nil {
			continue
		}
		out[snapshot.Spec.Field] = snapshot.Value
		hasPayload = hasPayload || hasItems(snapshot.Value)
	}
	return out, hasPayload
}

func (h *WSHub) sendRegisteredIndexSnapshot(conn *websocket.Conn) bool {
	for _, snapshot := range endpoints.Registry.Snapshots() {
		if snapshot.Spec.Message != "index" {
			continue
		}
		index, err := endpoints.ProjectIndex.Call(context.Background(), endpoints.Deps{Devtools: h.devtools})
		if err != nil {
			if snapshot.Spec.AlwaysSend {
				h.sendJSON(conn, apiIndexMessage(api.IndexData{}))
				return true
			}
			return false
		}
		h.sendJSON(conn, apiIndexMessage(index))
		return true
	}
	return false
}

func indexMessage(index store.IndexData) map[string]any {
	payload := map[string]any{}
	if raw, err := json.Marshal(index); err == nil {
		_ = json.Unmarshal(raw, &payload)
	}
	payload["type"] = "index"
	return payload
}

func apiIndexMessage(index api.IndexData) map[string]any {
	payload := map[string]any{}
	if raw, err := json.Marshal(index); err == nil {
		_ = json.Unmarshal(raw, &payload)
	}
	payload["type"] = "index"
	return payload
}

// sendJSON marshals and sends a single JSON message to a WebSocket connection.
func (h *WSHub) sendJSON(conn *websocket.Conn, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		slog.Error("snapshot marshal failed", "error", err)
		return
	}
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		slog.Error("snapshot write failed", "error", err)
	}
}

func hasItems(value any) bool {
	if value == nil {
		return false
	}
	v := reflect.ValueOf(value)
	switch v.Kind() {
	case reflect.Array, reflect.Chan, reflect.Map, reflect.Slice, reflect.String:
		return v.Len() > 0
	default:
		return true
	}
}

func fieldValue(value any, field string) any {
	if value == nil {
		return nil
	}
	v := reflect.ValueOf(value)
	if v.Kind() == reflect.Pointer {
		if v.IsNil() {
			return nil
		}
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return nil
	}
	f := v.FieldByName(field)
	if !f.IsValid() || !f.CanInterface() {
		return nil
	}
	return f.Interface()
}
