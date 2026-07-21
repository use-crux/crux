package jsonrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestServeDispatchesGoldenSessionInOrder(t *testing.T) {
	t.Parallel()

	input := bytes.NewReader(readGolden(t, "session.input"))
	var output bytes.Buffer
	methods := []string{}
	handler := HandlerFunc(func(_ context.Context, request protocol.Request) HandlerResult {
		methods = append(methods, request.Method)
		if request.Method == protocol.MethodInitialize {
			return HandlerResult{Result: map[string]any{"ready": true}}
		}
		return HandlerResult{}
	})

	if err := Serve(context.Background(), input, &output, io.Discard, handler); err != nil {
		t.Fatalf("serve session: %v", err)
	}

	if want := []string{protocol.MethodInitialize, protocol.MethodInitialized}; !reflect.DeepEqual(methods, want) {
		t.Fatalf("methods = %#v, want %#v", methods, want)
	}
	want := readGolden(t, "session.output")
	if !bytes.Equal(output.Bytes(), want) {
		t.Fatalf("session output mismatch\n--- got ---\n%q\n--- want ---\n%q", output.Bytes(), want)
	}
}

func TestServeReturnsParseErrorWithRecoverableStringID(t *testing.T) {
	t.Parallel()

	payload := []byte(`{"jsonrpc":"2.0","id":"broken-1","method":"initialize","params":{`)
	var input bytes.Buffer
	if err := NewWriter(&input).Write(payload); err != nil {
		t.Fatalf("frame malformed payload: %v", err)
	}
	var output bytes.Buffer
	if err := Serve(context.Background(), &input, &output, io.Discard, HandlerFunc(func(context.Context, protocol.Request) HandlerResult {
		t.Fatal("malformed JSON reached handler")
		return HandlerResult{}
	})); err != nil {
		t.Fatalf("serve malformed JSON: %v", err)
	}

	responsePayload := readSingleFrame(t, output.Bytes())
	var response protocol.Response
	if err := json.Unmarshal(responsePayload, &response); err != nil {
		t.Fatalf("decode parse error: %v", err)
	}
	if string(response.ID) != `"broken-1"` || response.Error == nil || response.Error.Code != protocol.ParseErrorCode {
		t.Fatalf("parse response = %#v, want id broken-1 and code %d", response, protocol.ParseErrorCode)
	}
}

func TestServeLogsMalformedHeaderWithoutWritingUncorrelatedResponse(t *testing.T) {
	t.Parallel()

	input := bytes.NewBufferString("Content-Length: nope\r\n\r\n")
	var output bytes.Buffer
	var logs bytes.Buffer
	if err := Serve(context.Background(), input, &output, &logs, HandlerFunc(func(context.Context, protocol.Request) HandlerResult {
		t.Fatal("malformed header reached handler")
		return HandlerResult{}
	})); err != nil {
		t.Fatalf("serve malformed header: %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("malformed header output = %q, want none without recoverable id", output.Bytes())
	}
	if logs.Len() == 0 {
		t.Fatal("malformed header was not logged")
	}
}

func TestServeReturnsInvalidRequestForValidJSONWithoutMethod(t *testing.T) {
	t.Parallel()

	var input bytes.Buffer
	if err := NewWriter(&input).Write([]byte(`{"jsonrpc":"2.0","id":9}`)); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := Serve(context.Background(), &input, &output, io.Discard, HandlerFunc(func(context.Context, protocol.Request) HandlerResult {
		t.Fatal("invalid request reached handler")
		return HandlerResult{}
	})); err != nil {
		t.Fatalf("serve invalid request: %v", err)
	}
	payload := readSingleFrame(t, output.Bytes())
	var response protocol.Response
	if err := json.Unmarshal(payload, &response); err != nil {
		t.Fatal(err)
	}
	if response.Error == nil || response.Error.Code != protocol.InvalidRequestCode {
		t.Fatalf("invalid request response = %#v, want code %d", response, protocol.InvalidRequestCode)
	}
}

func TestServeRejectsValidJSONWithInvalidRequestShapeOrID(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		payload []byte
		wantID  string
	}{
		{payload: []byte(`[]`), wantID: "null"},
		{payload: []byte(`{"jsonrpc":"2.0","id":true,"method":"shutdown"}`), wantID: "null"},
		{payload: []byte(`{"jsonrpc":"2.0","id":1,"method":42}`), wantID: "1"},
	} {
		var input bytes.Buffer
		if err := NewWriter(&input).Write(test.payload); err != nil {
			t.Fatal(err)
		}
		var output bytes.Buffer
		if err := Serve(context.Background(), &input, &output, io.Discard, HandlerFunc(func(context.Context, protocol.Request) HandlerResult {
			t.Fatal("invalid request reached handler")
			return HandlerResult{}
		})); err != nil {
			t.Fatalf("serve invalid request %s: %v", test.payload, err)
		}
		responsePayload := readSingleFrame(t, output.Bytes())
		var response protocol.Response
		if err := json.Unmarshal(responsePayload, &response); err != nil {
			t.Fatal(err)
		}
		if string(response.ID) != test.wantID || response.Error == nil || response.Error.Code != protocol.InvalidRequestCode {
			t.Fatalf("invalid request %s response = %#v, want id %s and code %d", test.payload, response, test.wantID, protocol.InvalidRequestCode)
		}
	}
}

func TestServeReturnsPermanentInputError(t *testing.T) {
	t.Parallel()

	want := errors.New("stdin failed")
	err := Serve(context.Background(), errorReader{err: want}, io.Discard, io.Discard, HandlerFunc(func(context.Context, protocol.Request) HandlerResult {
		t.Fatal("input error reached handler")
		return HandlerResult{}
	}))
	if !errors.Is(err, want) {
		t.Fatalf("Serve error = %v, want %v", err, want)
	}
}

func TestServeSerializesAsynchronousOutboundNotification(t *testing.T) {
	t.Parallel()

	inputReader, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	handler := &outboundTestHandler{notifications: make(chan protocol.Notification, 1)}
	done := make(chan error, 1)
	go func() {
		done <- Serve(context.Background(), inputReader, outputWriter, io.Discard, handler)
	}()

	handler.notifications <- protocol.Notification{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodLogMessage,
		Params:  protocol.LogMessageParams{Type: protocol.MessageTypeWarning, Message: "version skew"},
	}
	payloads := make(chan []byte, 1)
	go func() {
		payload, _ := NewReader(outputReader).Read()
		payloads <- payload
	}()
	select {
	case payload := <-payloads:
		if got := string(payload); got != `{"jsonrpc":"2.0","method":"window/logMessage","params":{"type":2,"message":"version skew"}}` {
			t.Fatalf("notification = %s", got)
		}
	case <-time.After(time.Second):
		t.Fatal("outbound notification was not written")
	}
	_ = inputWriter.Close()
	if err := <-done; err != nil {
		t.Fatalf("serve outbound notification: %v", err)
	}
}

func readSingleFrame(t *testing.T, framed []byte) []byte {
	t.Helper()
	payload, err := NewReader(bytes.NewReader(framed)).Read()
	if err != nil {
		t.Fatalf("read response frame: %v", err)
	}
	return payload
}

type errorReader struct{ err error }

func (r errorReader) Read([]byte) (int, error) { return 0, r.err }

type outboundTestHandler struct {
	notifications chan protocol.Notification
}

func (h *outboundTestHandler) Handle(context.Context, protocol.Request) HandlerResult {
	return HandlerResult{}
}

func (h *outboundTestHandler) Outbound() <-chan protocol.Notification {
	return h.notifications
}
