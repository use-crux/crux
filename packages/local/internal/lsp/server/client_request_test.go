package server

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestClientRequestsUseMonotonicIDsAndMatchResponses(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	if !server.RequestClient(protocol.MethodInlayHintRefresh, nil) ||
		!server.RequestClient(protocol.MethodCodeLensRefresh, nil) {
		t.Fatal("client request was not queued")
	}
	first, second := <-server.Outbound(), <-server.Outbound()
	if string(first.ID) != "1" || string(second.ID) != "2" {
		t.Fatalf("request IDs = %s, %s; want 1, 2", first.ID, second.ID)
	}
	if first.Method != protocol.MethodInlayHintRefresh || second.Method != protocol.MethodCodeLensRefresh {
		t.Fatalf("request methods = %q, %q", first.Method, second.Method)
	}

	server.HandleClientResponse(protocol.Response{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      json.RawMessage(`"1"`),
		Result:  json.RawMessage("null"),
	})
	server.clientRequestMu.Lock()
	if len(server.pendingClientRequests) != 2 {
		server.clientRequestMu.Unlock()
		t.Fatal("string response ID unexpectedly matched numeric request ID")
	}
	server.clientRequestMu.Unlock()
	server.HandleClientResponse(protocol.Response{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      json.RawMessage("1"),
		Result:  json.RawMessage("null"),
	})
	server.HandleClientResponse(protocol.Response{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      json.RawMessage("999"),
		Result:  json.RawMessage("null"),
	})
	server.clientRequestMu.Lock()
	defer server.clientRequestMu.Unlock()
	if len(server.pendingClientRequests) != 1 {
		t.Fatalf("pending requests = %d, want only id 2", len(server.pendingClientRequests))
	}
	if _, ok := server.pendingClientRequests["2"]; !ok {
		t.Fatalf("pending requests = %#v, want id 2", server.pendingClientRequests)
	}
}

func TestClientRequestTimeoutLogsAndDropsPendingRequest(t *testing.T) {
	t.Parallel()

	logs := make(chanLog, 1)
	server := New(Options{Logs: logs, ClientRequestTimeout: 5 * time.Millisecond})
	if !server.RequestClient(protocol.MethodInlayHintRefresh, nil) {
		t.Fatal("client request was not queued")
	}
	select {
	case message := <-logs:
		if message != "crux lsp: workspace/inlayHint/refresh request 1 timed out\n" {
			t.Fatalf("timeout log = %q", message)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout was not logged")
	}
	server.clientRequestMu.Lock()
	defer server.clientRequestMu.Unlock()
	if len(server.pendingClientRequests) != 0 {
		t.Fatalf("pending requests = %#v, want empty after timeout", server.pendingClientRequests)
	}
}

func TestClientErrorResponseResolvesPendingRequest(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	if !server.RequestClient(protocol.MethodInlayHintRefresh, nil) {
		t.Fatal("client request was not queued")
	}
	server.HandleClientResponse(protocol.Response{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      json.RawMessage("1"),
		Error: &protocol.ResponseError{
			Code: protocol.InternalErrorCode, Message: "client refresh failed",
		},
	})
	server.clientRequestMu.Lock()
	defer server.clientRequestMu.Unlock()
	if len(server.pendingClientRequests) != 0 {
		t.Fatalf("pending requests = %#v, want error response to resolve request", server.pendingClientRequests)
	}
}

type chanLog chan string

func (w chanLog) Write(content []byte) (int, error) {
	w <- string(content)
	return len(content), nil
}

func TestClientRequestDropsWithoutBlockingWhenOutboundQueueIsFull(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	for index := 0; index < cap(server.outbound); index++ {
		if !server.Notify(context.Background(), protocol.MethodLogMessage, map[string]int{"index": index}) {
			t.Fatalf("notification %d was not queued", index)
		}
	}
	if server.RequestClient(protocol.MethodInlayHintRefresh, nil) {
		t.Fatal("request unexpectedly queued into a full outbound channel")
	}
	server.clientRequestMu.Lock()
	defer server.clientRequestMu.Unlock()
	if len(server.pendingClientRequests) != 0 {
		t.Fatalf("pending requests = %#v, want no entry for dropped request", server.pendingClientRequests)
	}
}

func TestCloseClientRequestsStopsPendingTimeouts(t *testing.T) {
	t.Parallel()

	logs := make(chanLog, 1)
	server := New(Options{Logs: logs, ClientRequestTimeout: 10 * time.Millisecond})
	if !server.RequestClient(protocol.MethodInlayHintRefresh, nil) {
		t.Fatal("client request was not queued")
	}
	server.CloseClientRequests()
	time.Sleep(25 * time.Millisecond)
	select {
	case message := <-logs:
		t.Fatalf("closed client request logged a timeout: %q", message)
	default:
	}
	server.clientRequestMu.Lock()
	defer server.clientRequestMu.Unlock()
	if len(server.pendingClientRequests) != 0 {
		t.Fatalf("pending requests = %#v, want empty after close", server.pendingClientRequests)
	}
}
