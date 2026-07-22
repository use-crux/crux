package jsonrpc

import (
	"context"
	"encoding/json"
	"io"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestServeWritesOutboundRequestAndRoutesClientResponse(t *testing.T) {
	t.Parallel()

	inputReader, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	handler := &outboundResponseTestHandler{
		outbound:  make(chan protocol.OutboundMessage, 1),
		responses: make(chan protocol.Response, 1),
		closed:    make(chan struct{}),
	}
	done := make(chan error, 1)
	go func() {
		done <- Serve(context.Background(), inputReader, outputWriter, io.Discard, handler)
	}()

	handler.outbound <- protocol.OutboundMessage{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      json.RawMessage("1"),
		Method:  protocol.MethodInlayHintRefresh,
	}
	payload, err := NewReader(outputReader).Read()
	if err != nil {
		t.Fatal(err)
	}
	if got := string(payload); got != `{"jsonrpc":"2.0","id":1,"method":"workspace/inlayHint/refresh"}` {
		t.Fatalf("outbound request = %s", got)
	}

	if err := NewWriter(inputWriter).Write([]byte(`{"jsonrpc":"2.0","id":1,"result":null}`)); err != nil {
		t.Fatal(err)
	}
	select {
	case response := <-handler.responses:
		if string(response.ID) != "1" || string(response.Result) != "null" || response.Error != nil {
			t.Fatalf("client response = %#v", response)
		}
	case <-time.After(time.Second):
		t.Fatal("client response was not routed")
	}

	_ = inputWriter.Close()
	if err := <-done; err != nil {
		t.Fatalf("serve outbound request: %v", err)
	}
	select {
	case <-handler.closed:
	default:
		t.Fatal("client request state was not closed with the session")
	}
}

type outboundResponseTestHandler struct {
	outbound  chan protocol.OutboundMessage
	responses chan protocol.Response
	closed    chan struct{}
}

func (h *outboundResponseTestHandler) Handle(context.Context, protocol.Request) HandlerResult {
	return HandlerResult{}
}

func (h *outboundResponseTestHandler) Outbound() <-chan protocol.OutboundMessage {
	return h.outbound
}

func (h *outboundResponseTestHandler) HandleClientResponse(response protocol.Response) {
	h.responses <- response
}

func (h *outboundResponseTestHandler) CloseClientRequests() {
	close(h.closed)
}
