package resourceinspection

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/anthropics/crux-cli/internal/runtimebridge"
)

func TestCapabilitiesWithoutBridge(t *testing.T) {
	svc := New(runtimebridge.NewService(nil))

	caps, err := svc.Capabilities(context.Background())
	if err != nil {
		t.Fatalf("Capabilities returned error: %v", err)
	}
	if caps.LiveRuntime.Available {
		t.Fatalf("expected no live runtime")
	}
	if caps.Features.LiveStoreRead || caps.Features.MemoryInspect || caps.Features.BlackboardInspect {
		t.Fatalf("expected no live resource features: %+v", caps.Features)
	}
}

func TestCapabilitiesWithStoreReadPeer(t *testing.T) {
	bridge := runtimebridge.NewService(nil)
	bridge.RegisterPeer(storeReadPeer("peer_1", ""), nil)
	svc := New(bridge)

	caps, err := svc.Capabilities(context.Background())
	if err != nil {
		t.Fatalf("Capabilities returned error: %v", err)
	}
	if !caps.LiveRuntime.Available {
		t.Fatalf("expected live runtime")
	}
	if !caps.Features.LiveStoreRead || !caps.Features.MemoryInspect || !caps.Features.BlackboardInspect {
		t.Fatalf("expected live resource features: %+v", caps.Features)
	}
	if len(caps.LiveRuntime.Resources) != 1 || caps.LiveRuntime.Resources[0].Resource != "crux.store" {
		t.Fatalf("unexpected resources: %+v", caps.LiveRuntime.Resources)
	}
}

func TestGetBlackboardViaBridge(t *testing.T) {
	bridge, closeServer := bridgeWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req runtimebridge.CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode command: %v", err)
		}
		if req.Command != "store.read" {
			t.Fatalf("unexpected command %q", req.Command)
		}
		var payload map[string]any
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload["operation"] != "get" || payload["resource"] != "blackboard:thread:abc" {
			t.Fatalf("unexpected payload: %+v", payload)
		}
		writeBridgeResult(w, req.CommandID, map[string]any{
			"value": map[string]any{"content": "{\"status\":\"ready\"}"},
		})
	})
	defer closeServer()
	svc := New(bridge)

	result, err := svc.Get(context.Background(), GetRequest{ResourceID: "blackboard:thread:abc"})
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if result.Status != StatusOK || result.Source != SourceRuntimeBridge || result.Kind != "blackboard" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if !strings.Contains(string(result.Value), "ready") {
		t.Fatalf("expected bridge value in result, got %s", result.Value)
	}
}

func TestListMemoryViaBridge(t *testing.T) {
	bridge, closeServer := bridgeWithHandler(t, func(w http.ResponseWriter, r *http.Request) {
		var req runtimebridge.CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode command: %v", err)
		}
		var payload map[string]any
		if err := json.Unmarshal(req.Payload, &payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		if payload["operation"] != "list" || payload["resource"] != "memory:project" || payload["limit"].(float64) != 2 {
			t.Fatalf("unexpected payload: %+v", payload)
		}
		writeBridgeResult(w, req.CommandID, map[string]any{
			"entries": []map[string]any{
				{"key": "memory:project:1", "value": map[string]any{"text": "one"}},
			},
		})
	})
	defer closeServer()
	svc := New(bridge)

	result, err := svc.List(context.Background(), ListRequest{ResourceID: "memory:project", Limit: 2})
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if result.Status != StatusOK || len(result.Entries) != 1 || result.Entries[0].Key != "memory:project:1" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestUnavailableWhenBridgeMissing(t *testing.T) {
	svc := New(runtimebridge.NewService(nil))

	result, err := svc.Get(context.Background(), GetRequest{ResourceID: "blackboard:thread:abc"})
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if result.Status != StatusUnavailable || result.Reason != ReasonBridgeRequired || result.DocsURL == "" {
		t.Fatalf("unexpected unavailable result: %+v", result)
	}
}

func TestAmbiguousPeer(t *testing.T) {
	bridge := runtimebridge.NewService(nil)
	bridge.RegisterPeer(storeReadPeer("peer_1", "https://one.example/crux/bridge"), nil)
	bridge.RegisterPeer(storeReadPeer("peer_2", "https://two.example/crux/bridge"), nil)
	svc := New(bridge)

	result, err := svc.Get(context.Background(), GetRequest{ResourceID: "blackboard:thread:abc"})
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if result.Status != StatusUnavailable || result.Reason != ReasonAmbiguousPeer {
		t.Fatalf("unexpected ambiguous result: %+v", result)
	}
}

func bridgeWithHandler(t *testing.T, handler http.HandlerFunc) (*runtimebridge.Service, func()) {
	t.Helper()
	server := httptest.NewServer(handler)
	bridge := runtimebridge.NewService(server.Client())
	bridge.RegisterPeer(storeReadPeer("peer_1", server.URL), nil)
	return bridge, server.Close
}

func storeReadPeer(peerID, endpointURL string) runtimebridge.Peer {
	return runtimebridge.Peer{
		PeerID:      peerID,
		RuntimeName: "test-runtime",
		Environment: "convex",
		Transport:   runtimebridge.TransportHTTP,
		EndpointURL: endpointURL,
		Capabilities: []runtimebridge.Capability{
			{
				Command: "store.read",
				Resources: []runtimebridge.StoreResource{
					{Resource: "crux.store", Operations: []string{"get", "list"}, Description: "Test store"},
				},
			},
		},
	}
}

func writeBridgeResult(w http.ResponseWriter, commandID string, result any) {
	w.Header().Set("Content-Type", "application/json")
	body, _ := json.Marshal(map[string]any{
		"type":      "command.result",
		"commandId": commandID,
		"result":    result,
	})
	_, _ = w.Write(body)
}
