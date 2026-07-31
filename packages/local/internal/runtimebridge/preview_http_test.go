package runtimebridge

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

func TestPreviewHTTPRevalidatesManifestBeforePOST(t *testing.T) {
	postCalls := 0
	target := "prompt:current"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet {
			_ = json.NewEncoder(writer).Encode(previewManifest(3, target))
			return
		}
		postCalls++
		var command CommandRequest
		_ = json.NewDecoder(request.Body).Decode(&command)
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"type": "command.result", "commandId": command.CommandID,
			"result": map[string]any{
				"status": "ready", "targetId": target, "catalogueRevision": 3,
				"preview": map[string]any{
					"status": "fits", "measurement": "exact",
					"adaptations": []any{}, "warnings": []any{}, "diagnostics": []any{},
				},
				"contributions": []any{},
			},
		})
	}))
	defer server.Close()

	service := NewService(server.Client())
	peer := previewPeer(t, "peer-http", 3, target)
	peer.Transport = TransportHTTP
	peer.EndpointURL = server.URL
	service.RegisterPeer(peer, nil)

	response, err := service.Dispatch(context.Background(), DispatchRequest{
		Command: preview.Command, TargetID: target, CatalogueRevision: 3,
		Payload: json.RawMessage(`{"input":{}}`),
	})
	if err != nil || response.PeerID != "peer-http" || postCalls != 1 {
		t.Fatalf("Dispatch = %#v, %v; post calls = %d", response, err, postCalls)
	}

	target = "prompt:replacement"
	_, err = service.Dispatch(context.Background(), DispatchRequest{
		Command: preview.Command, TargetID: "prompt:current", CatalogueRevision: 3,
		Payload: json.RawMessage(`{"input":{}}`),
	})
	if !preview.IsFailure(err, "target_disappeared") || postCalls != 1 {
		t.Fatalf("stale Dispatch error = %v; post calls = %d", err, postCalls)
	}
}

func TestPreviewHTTPRejectsRedirectAwayFromLoopback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, "https://example.com/bridge", http.StatusFound)
	}))
	defer server.Close()
	service := NewService(server.Client())
	peer := previewPeer(t, "peer-http", 1, "prompt:x")
	peer.Transport = TransportHTTP
	peer.EndpointURL = server.URL
	service.RegisterPeer(peer, nil)

	_, err := service.Dispatch(context.Background(), DispatchRequest{
		Command: preview.Command, TargetID: "prompt:x", CatalogueRevision: 1,
		Payload: json.RawMessage(`{"input":{}}`),
	})
	if !preview.IsFailure(err, "endpoint_not_allowed") {
		t.Fatalf("Dispatch error = %v", err)
	}
}

func TestPreviewHTTPRevalidatesManifestAfterTerminalResponse(t *testing.T) {
	revision := uint64(4)
	target := "prompt:before"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet {
			_ = json.NewEncoder(writer).Encode(previewManifest(revision, target))
			return
		}
		var command CommandRequest
		_ = json.NewDecoder(request.Body).Decode(&command)
		target = "prompt:after"
		revision++
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"type": "command.result", "commandId": command.CommandID,
			"result": map[string]any{
				"status": "ready", "targetId": command.TargetID,
				"catalogueRevision": command.CatalogueRevision,
				"preview": map[string]any{
					"status": "fits", "measurement": "exact",
					"adaptations": []any{}, "warnings": []any{}, "diagnostics": []any{},
				},
				"contributions": []any{},
			},
		})
	}))
	defer server.Close()

	service := NewService(server.Client())
	peer := previewPeer(t, "peer-http", 4, "prompt:before")
	peer.Transport = TransportHTTP
	peer.EndpointURL = server.URL
	service.RegisterPeer(peer, nil)
	_, err := service.Dispatch(context.Background(), DispatchRequest{
		Command: preview.Command, TargetID: "prompt:before", CatalogueRevision: 4,
		Payload: json.RawMessage(`{"input":{}}`),
	})
	if !preview.IsFailure(err, "target_disappeared") {
		t.Fatalf("Dispatch error = %v", err)
	}
}

func TestPreviewHTTPCancellationStopsTheRuntimeRequest(t *testing.T) {
	postStarted := make(chan struct{}, 1)
	postCancelled := make(chan struct{}, 1)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method == http.MethodGet {
			body, _ := json.Marshal(previewManifest(1, "prompt:x"))
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(string(body))),
			}, nil
		}
		postStarted <- struct{}{}
		<-request.Context().Done()
		postCancelled <- struct{}{}
		return nil, request.Context().Err()
	})}
	service := NewService(client)
	peer := previewPeer(t, "peer-http", 1, "prompt:x")
	peer.Transport = TransportHTTP
	peer.EndpointURL = "http://127.0.0.1/bridge"
	service.RegisterPeer(peer, nil)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := service.Dispatch(ctx, DispatchRequest{
			Command: preview.Command, TargetID: "prompt:x", CatalogueRevision: 1,
			Payload: json.RawMessage(`{"input":{}}`),
		})
		done <- err
	}()
	<-postStarted
	cancel()
	if err := <-done; !preview.IsFailure(err, "cancelled") {
		t.Fatalf("Dispatch error = %v", err)
	}
	select {
	case <-postCancelled:
	case <-time.After(time.Second):
		t.Fatal("runtime POST was not cancelled")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func previewManifest(revision uint64, target string) map[string]any {
	return map[string]any{
		"enabled": true,
		"capabilities": []any{map[string]any{
			"command": "prompt.previewExact", "catalogueRevision": revision,
			"targets": []any{map[string]any{
				"definitionId": target, "kind": "prompt", "name": "target",
				"input": map[string]any{"mode": "none"},
			}},
		}},
	}
}
