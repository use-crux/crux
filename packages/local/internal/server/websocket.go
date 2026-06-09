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
		for _, msg := range libraryInvalidationMessages(event) {
			h.BroadcastJSON(msg)
		}
	}
}

func libraryInvalidationMessages(event observability.Event) []map[string]any {
	payload := map[string]any{
		"id":        event.ID,
		"timestamp": event.Timestamp,
		"refId":     event.RefID,
		"action":    event.Action,
	}
	switch {
	case event.Kind == "memory" || event.Kind == "memory.read" || event.Kind == "memory.write":
		return []map[string]any{{
			"type":  "memory:event",
			"_tag":  "MemoryStoreEvent",
			"kind":  "state",
			"event": payload,
		}}
	case event.Kind == "workspace" || event.Kind == "workspace.operation":
		return []map[string]any{{
			"type":  "workspace:event",
			"_tag":  "WorkspaceEvent",
			"kind":  "op",
			"event": payload,
		}}
	case event.Kind == "plan" || event.Kind == "plan.operation":
		return []map[string]any{{
			"type":  "plan:event",
			"_tag":  "PlanEvent",
			"kind":  "plan",
			"event": payload,
		}}
	case event.Kind == "task" || event.Kind == "task.operation":
		return []map[string]any{{
			"type":  "plan:event",
			"_tag":  "PlanEvent",
			"kind":  "task",
			"event": payload,
		}}
	default:
		return nil
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
	index := snapshotValue(h, "/api/index")
	if typed, ok := index.(store.IndexData); ok {
		h.sendJSON(conn, indexMessage(typed))
	} else {
		h.sendJSON(conn, map[string]any{
			"type":     "index",
			"prompts":  fieldValue(index, "Prompts"),
			"contexts": fieldValue(index, "Contexts"),
			"tools":    fieldValue(index, "Tools"),
		})
	}

	// Eval runs
	evals := snapshotValue(h, "/api/evals")
	if hasItems(evals) {
		h.sendJSON(conn, map[string]any{
			"type":     "eval:snapshot",
			"evalRuns": evals,
		})
	}

	ragEvals := snapshotValue(h, "/api/rag-evals")
	if hasItems(ragEvals) {
		h.sendJSON(conn, map[string]any{
			"type":        "rag-eval:snapshot",
			"ragEvalRuns": ragEvals,
		})
	}

	// Flow runs
	flows := snapshotValue(h, "/api/flows")
	if hasItems(flows) {
		h.sendJSON(conn, map[string]any{
			"type":     "flow:snapshot",
			"flowRuns": flows,
		})
	}

	// Runtime events
	embeddingEvents := snapshotValue(h, "/api/embedding")
	retrievalEvents := snapshotValue(h, "/api/retrieval")
	retrievalStageEvents := snapshotValue(h, "/api/retrieval-stages")
	indexEvents := snapshotValue(h, "/api/index/events")
	corpusEvents := snapshotValue(h, "/api/corpus")
	ingestEvents := snapshotValue(h, "/api/ingest")
	compactEvents := snapshotValue(h, "/api/compaction")
	budgetSnapshots := snapshotValue(h, "/api/budget")
	costEvents := snapshotValue(h, "/api/cost")
	agentEvents := snapshotValue(h, "/api/agent")
	judgeEvents := snapshotValue(h, "/api/judges")
	delegateEvents := snapshotValue(h, "/api/delegates")
	toolEvents := snapshotValue(h, "/api/tools/events")
	securityEvents := snapshotValue(h, "/api/security/events")

	hasRuntime := hasItems(embeddingEvents) || hasItems(retrievalEvents) || hasItems(retrievalStageEvents) || hasItems(indexEvents) || hasItems(corpusEvents) || hasItems(ingestEvents) || hasItems(compactEvents) ||
		hasItems(budgetSnapshots) || hasItems(costEvents) || hasItems(agentEvents) ||
		hasItems(judgeEvents) || hasItems(delegateEvents) ||
		hasItems(toolEvents) || hasItems(securityEvents)

	if hasRuntime {
		h.sendJSON(conn, map[string]any{
			"type":                 "runtime:snapshot",
			"embeddingEvents":      embeddingEvents,
			"retrievalEvents":      retrievalEvents,
			"retrievalStageEvents": retrievalStageEvents,
			"indexEvents":          indexEvents,
			"corpusEvents":         corpusEvents,
			"ingestEvents":         ingestEvents,
			"memoryEvents":         []any{},
			"compactEvents":        compactEvents,
			"budgetSnapshots":      budgetSnapshots,
			"costEvents":           costEvents,
			"agentEvents":          agentEvents,
			"judgeEvents":          judgeEvents,
			"delegateEvents":       delegateEvents,
			"toolEvents":           toolEvents,
			"securityEvents":       securityEvents,
		})
	}
}

func indexMessage(index store.IndexData) map[string]any {
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

func snapshotValue(h *WSHub, path string) any {
	value, found, err := h.devtools.Get(context.Background(), path, nil)
	if err != nil || !found {
		return nil
	}
	return value
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
