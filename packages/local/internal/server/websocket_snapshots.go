package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"reflect"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// sendSnapshot sends the full store state to a newly connected client.
// Sends multiple separate messages matching the Node.js server format expected
// by the UI reducer: index, snapshot, eval:snapshot, and related messages.
func (h *WSHub) sendSnapshot(client *wsClient) {
	// Index is always sent so the UI can mark indexReceived=true.
	if !h.sendRegisteredIndexSnapshot(client) {
		h.sendJSON(client, apiIndexMessage(api.IndexData{}))
	}

	if message, ok := registeredSnapshotMessage(h, "eval:snapshot"); ok {
		h.sendJSON(client, message)
	}
	if message, ok := registeredSnapshotMessage(h, "rag-eval:snapshot"); ok {
		h.sendJSON(client, message)
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

func (h *WSHub) sendRegisteredIndexSnapshot(client *wsClient) bool {
	for _, snapshot := range endpoints.Registry.Snapshots() {
		if snapshot.Spec.Message != "index" {
			continue
		}
		index, err := endpoints.ProjectIndex.Call(context.Background(), endpoints.Deps{Devtools: h.devtools})
		if err != nil {
			if snapshot.Spec.AlwaysSend {
				h.sendJSON(client, apiIndexMessage(api.IndexData{}))
				return true
			}
			return false
		}
		h.sendJSON(client, apiIndexMessage(index))
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

// sendJSON marshals and queues a single JSON message to a WebSocket client.
func (h *WSHub) sendJSON(client *wsClient, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		slog.Error("snapshot marshal failed", "error", err)
		return
	}
	if !client.enqueue(data) {
		slog.Debug("snapshot enqueue failed, removing client")
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
