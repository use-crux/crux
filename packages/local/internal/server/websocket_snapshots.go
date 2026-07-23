package server

import (
	"context"
	"encoding/json"
	"reflect"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// sendSnapshotLocked sends the full store state to a newly connected client.
// Sends multiple separate messages matching the Node.js server format expected
// by the UI reducer: index, snapshot, eval:snapshot, and related messages.
// The caller holds indexMu so the index message is queued before any delta.
func (h *WSHub) sendSnapshotLocked(client *wsClient) {
	// Index is always sent so the UI can mark indexReceived=true.
	if !h.sendRegisteredIndexSnapshotLocked(client) {
		h.sendJSON(client, apiIndexMessage(h.emptyProjectIndexLocked()))
	}

	if message, ok := registeredSnapshotMessage(h, "flow:snapshot"); ok {
		h.sendJSON(client, message)
	}
	if message, ok := registeredSnapshotMessage(h, "runtime:snapshot"); ok {
		message["memoryEvents"] = []any{}
		h.sendJSON(client, message)
	}
}

func registeredSnapshotMessage(h *WSHub, message string) (map[string]any, bool) {
	out := map[string]any{"type": message}
	hasPayload := false
	for _, snapshot := range endpoints.Registry.SnapshotValues(h.snapshotContext(), endpoints.Deps{Devtools: h.devtools}, message) {
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

func (h *WSHub) sendRegisteredIndexSnapshotLocked(client *wsClient) bool {
	for _, snapshot := range endpoints.Registry.Snapshots() {
		if snapshot.Spec.Message != "index" {
			continue
		}
		index, err := h.projectIndexLocked()
		if err != nil {
			if snapshot.Spec.AlwaysSend {
				h.sendJSON(client, apiIndexMessage(h.emptyProjectIndexLocked()))
				return true
			}
			return false
		}
		h.sendJSON(client, apiIndexMessage(index))
		return true
	}
	return false
}

func (h *WSHub) snapshotContext() context.Context {
	if h != nil && h.ctx != nil {
		return h.ctx
	}
	return context.Background()
}

type indexSnapshotMessage struct {
	Type          string `json:"type"`
	ProjectRoot   string `json:"projectRoot"`
	ServerVersion string `json:"serverVersion"`
	Generation    uint64 `json:"generation"`
	store.IndexData
}

type apiIndexSnapshotMessage struct {
	Type string `json:"type"`
	api.IndexData
}

func (h *WSHub) indexMessage(index store.IndexData, generation uint64) indexSnapshotMessage {
	return indexSnapshotMessage{
		Type:          "index",
		ProjectRoot:   h.projectRoot,
		ServerVersion: h.serverVersion,
		Generation:    generation,
		IndexData:     index,
	}
}

func apiIndexMessage(index api.IndexData) apiIndexSnapshotMessage {
	return apiIndexSnapshotMessage{Type: "index", IndexData: index}
}

// sendJSON marshals and queues a single JSON message to a WebSocket client.
func (h *WSHub) sendJSON(client *wsClient, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		h.log().Error("snapshot marshal failed", "error", err)
		return
	}
	if !client.enqueue(data) {
		h.log().Debug("snapshot enqueue failed, removing client")
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
