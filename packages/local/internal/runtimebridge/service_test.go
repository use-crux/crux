package runtimebridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestServiceRoutesDiagnosticsToItsLogger(t *testing.T) {
	previous := slog.Default()
	var processLogs bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&processLogs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	var serviceLogs bytes.Buffer
	service := NewService(nil, WithLogger(slog.New(slog.NewTextHandler(&serviceLogs, nil))))
	service.RegisterPeer(Peer{PeerID: "peer_scoped_logger", Transport: TransportWS}, nil)

	const diagnostic = "runtime bridge peer registered"
	if !strings.Contains(serviceLogs.String(), diagnostic) {
		t.Fatalf("service logs = %q, want %q", serviceLogs.String(), diagnostic)
	}
	if strings.Contains(processLogs.String(), diagnostic) {
		t.Fatalf("runtime bridge diagnostic escaped to process logger: %q", processLogs.String())
	}
}

func TestServiceRegistersPeerAndPublishesEvent(t *testing.T) {
	svc := NewService(nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := svc.Subscribe(ctx)

	peer := svc.RegisterPeer(Peer{
		PeerID:      "peer_1",
		RuntimeName: "local",
		Transport:   TransportWS,
		Capabilities: []Capability{{
			Command: "store.read",
		}},
	}, nil)

	if peer.PeerID != "peer_1" {
		t.Fatalf("peer id = %q", peer.PeerID)
	}
	if got := len(svc.Peers()); got != 1 {
		t.Fatalf("peer count = %d", got)
	}
	select {
	case event := <-events:
		if event.Action != "peer.connected" || event.PeerID != "peer_1" {
			t.Fatalf("unexpected event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for peer event")
	}
}

func TestServiceDispatchesWebSocketCommand(t *testing.T) {
	svc := NewService(nil)
	sent := make(chan CommandRequest, 1)
	svc.RegisterPeer(Peer{
		PeerID:    "peer_ws",
		Transport: TransportWS,
		Capabilities: []Capability{{
			Command: "store.read",
		}},
	}, func(_ context.Context, data []byte) error {
		var req CommandRequest
		if err := json.Unmarshal(data, &req); err != nil {
			return err
		}
		sent <- req
		return nil
	})

	done := make(chan DispatchResponse, 1)
	go func() {
		resp, err := svc.Dispatch(context.Background(), DispatchRequest{
			Command: "store.read",
			Payload: json.RawMessage(`{"operation":"get","resource":"crux.store","key":"memory:1"}`),
		})
		if err != nil {
			t.Errorf("dispatch failed: %v", err)
		}
		done <- resp
	}()

	req := <-sent
	if req.Type != "command.request" || req.Command != "store.read" || req.CommandID == "" {
		t.Fatalf("unexpected command request: %#v", req)
	}
	result := CommandResult{
		Type:      "command.result",
		CommandID: req.CommandID,
		Result:    json.RawMessage(`{"value":{"ok":true}}`),
		RunIDs:    []string{"run_current"},
		TraceIDs:  []string{"0123456789abcdef0123456789abcdef"},
	}
	data, _ := json.Marshal(result)
	if err := svc.HandlePeerMessage("peer_ws", data); err != nil {
		t.Fatalf("handle peer result: %v", err)
	}

	select {
	case resp := <-done:
		if string(resp.Result) != `{"value":{"ok":true}}` {
			t.Fatalf("unexpected result: %s", resp.Result)
		}
		if len(resp.RunIDs) != 1 || resp.RunIDs[0] != "run_current" || len(resp.TraceIDs) != 1 || resp.TraceIDs[0] != "0123456789abcdef0123456789abcdef" {
			t.Fatalf("run/trace references were not preserved distinctly: %#v", resp)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for dispatch result")
	}
}

func TestServiceDispatchesHTTPCommand(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req CommandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Command != "store.read" {
			t.Fatalf("command = %q", req.Command)
		}
		_ = json.NewEncoder(w).Encode(CommandResult{
			Type:      "command.result",
			CommandID: req.CommandID,
			Result:    json.RawMessage(`{"entries":[]}`),
		})
	}))
	defer server.Close()

	svc := NewService(server.Client())
	svc.RegisterPeer(Peer{
		PeerID:      "peer_http",
		Transport:   TransportHTTP,
		EndpointURL: server.URL,
		Capabilities: []Capability{{
			Command: "store.read",
		}},
	}, nil)

	resp, err := svc.Dispatch(context.Background(), DispatchRequest{
		Command: "store.read",
		Payload: json.RawMessage(`{"operation":"list","resource":"crux.store","prefix":"memory:"}`),
	})
	if err != nil {
		t.Fatalf("dispatch failed: %v", err)
	}
	if resp.PeerID != "peer_http" || string(resp.Result) != `{"entries":[]}` {
		t.Fatalf("unexpected response: %#v", resp)
	}
}

func TestServiceRejectsNonLoopbackHTTPPeer(t *testing.T) {
	svc := NewService(http.DefaultClient)
	svc.RegisterPeer(Peer{
		PeerID:       "peer_ssrf",
		Transport:    TransportHTTP,
		EndpointURL:  "http://169.254.169.254/latest/meta-data/",
		Capabilities: []Capability{{Command: "store.read"}},
	}, nil)

	_, err := svc.Dispatch(context.Background(), DispatchRequest{Command: "store.read"})
	if !errors.Is(err, ErrPeerEndpointNotAllowed) {
		t.Fatalf("dispatch err = %v, want ErrPeerEndpointNotAllowed", err)
	}
}

func TestIsLoopbackEndpoint(t *testing.T) {
	cases := map[string]bool{
		"http://127.0.0.1:4400":         true,
		"http://localhost:9999/cmd":     true,
		"http://[::1]:8080":             true,
		"http://169.254.169.254/latest": false,
		"http://10.0.0.5:3000":          false,
		"https://evil.example/cb":       false,
		"http://2130706433/":            false, // 127.0.0.1 as int — not parsed as loopback
		"":                              false,
	}
	for endpoint, want := range cases {
		if got := IsLoopbackEndpoint(endpoint); got != want {
			t.Errorf("IsLoopbackEndpoint(%q) = %v, want %v", endpoint, got, want)
		}
	}
}
