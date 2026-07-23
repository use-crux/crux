package jsonrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// HandlerResult is the outcome of one dispatched JSON-RPC message.
type HandlerResult struct {
	Result any
	Error  *protocol.ResponseError
	Stop   bool
	// Deferred completes authorized long-running work after serial preflight.
	// The transport may write its response out of request order.
	Deferred func() HandlerResult
}

// Handler processes decoded JSON-RPC requests and notifications.
type Handler interface {
	Handle(context.Context, protocol.Request) HandlerResult
}

// OutboundHandler exposes asynchronous server-to-client requests and
// notifications. Serve funnels them through the same single writer as
// request responses.
type OutboundHandler interface {
	Outbound() <-chan protocol.OutboundMessage
}

// ClientResponseHandler accepts responses to server-to-client requests.
type ClientResponseHandler interface {
	HandleClientResponse(protocol.Response)
}

// ClientRequestCloser releases pending server-to-client request state when
// the stdio session ends without an explicit LSP shutdown.
type ClientRequestCloser interface {
	CloseClientRequests()
}

// HandlerFunc adapts a function into a Handler.
type HandlerFunc func(context.Context, protocol.Request) HandlerResult

func (f HandlerFunc) Handle(ctx context.Context, request protocol.Request) HandlerResult {
	return f(ctx, request)
}

type readEvent struct {
	payload []byte
	err     error
}

// Serve runs a framed JSON-RPC connection until EOF, cancellation, or a
// handler-requested stop. Preflight stays serial and framed writes have one
// owner; explicitly deferred responses may complete out of request order.
func Serve(ctx context.Context, input io.Reader, output io.Writer, logs io.Writer, handler Handler) error {
	if logs == nil {
		logs = io.Discard
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if closer, ok := handler.(ClientRequestCloser); ok {
		defer closer.CloseClientRequests()
	}

	reads := make(chan readEvent)
	go readFrames(ctx, NewReader(input), reads)

	responses := make(chan []byte, 16)
	writesDone := make(chan error, 1)
	go writeFrames(NewWriter(output), responses, writesDone)

	requests := make(chan protocol.Request)
	stop := make(chan struct{}, 1)
	workerDone := make(chan struct{})
	go dispatch(ctx, handler, requests, responses, stop, workerDone)
	var outbound <-chan protocol.OutboundMessage
	if source, ok := handler.(OutboundHandler); ok {
		outbound = source.Outbound()
	}

	var serveErr error
	writesFinished := false
running:
	for {
		select {
		case <-ctx.Done():
			break running
		case <-stop:
			break running
		case message, ok := <-outbound:
			if !ok {
				outbound = nil
				continue
			}
			encoded, err := json.Marshal(message)
			if err != nil {
				fmt.Fprintf(logs, "crux lsp: encode outbound message: %v\n", err)
				continue
			}
			if err := queueResponse(ctx, responses, encoded); err != nil {
				serveErr = err
				break running
			}
		case event, ok := <-reads:
			if !ok || errors.Is(event.err, io.EOF) {
				break running
			}
			if event.err != nil {
				fmt.Fprintf(logs, "crux lsp: %v\n", event.err)
				var frameErr *FrameError
				if errors.As(event.err, &frameErr) {
					continue
				}
				serveErr = event.err
				break running
			}
			if response, recognized, responseErr := decodeClientResponse(event.payload); recognized {
				if responseErr != nil {
					fmt.Fprintf(logs, "crux lsp: invalid client response: %v\n", responseErr)
					continue
				}
				if sink, ok := handler.(ClientResponseHandler); ok {
					sink.HandleClientResponse(response)
				}
				continue
			}
			request, parseErr := decodeRequest(event.payload)
			if parseErr != nil {
				fmt.Fprintf(logs, "crux lsp: %v\n", parseErr)
				id := recoverID(event.payload)
				if parseErr.code == protocol.InvalidRequestCode && len(id) == 0 {
					id = json.RawMessage("null")
				}
				if len(id) > 0 {
					if err := queueResponse(ctx, responses, errorResponse(id, parseErr.code, parseErr.message)); err != nil {
						serveErr = err
						break running
					}
				}
				continue
			}
			select {
			case requests <- request:
			case <-ctx.Done():
				break running
			}
		case err := <-writesDone:
			serveErr = err
			writesFinished = true
			cancel()
			break running
		}
	}

	cancel()
	close(requests)
	<-workerDone
	close(responses)
	if !writesFinished {
		if err := <-writesDone; serveErr == nil {
			serveErr = err
		}
	}
	return serveErr
}

func readFrames(ctx context.Context, reader *Reader, events chan<- readEvent) {
	defer close(events)
	for {
		payload, err := reader.Read()
		select {
		case events <- readEvent{payload: payload, err: err}:
		case <-ctx.Done():
			return
		}
		if errors.Is(err, io.EOF) {
			return
		}
	}
}

func writeFrames(writer *Writer, responses <-chan []byte, done chan<- error) {
	for response := range responses {
		if err := writer.Write(response); err != nil {
			done <- err
			return
		}
	}
	done <- nil
}

type requestDecodeError struct {
	code    int
	message string
	cause   error
}

func (e *requestDecodeError) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %v", e.message, e.cause)
	}
	return e.message
}

func decodeRequest(payload []byte) (protocol.Request, *requestDecodeError) {
	if !json.Valid(payload) {
		return protocol.Request{}, &requestDecodeError{
			code: protocol.ParseErrorCode, message: "Parse error",
		}
	}
	var request protocol.Request
	if err := json.Unmarshal(payload, &request); err != nil {
		return protocol.Request{}, &requestDecodeError{
			code: protocol.InvalidRequestCode, message: "Invalid Request", cause: err,
		}
	}
	if request.JSONRPC != protocol.JSONRPCVersion || request.Method == "" || !validRequestID(request.ID) {
		return protocol.Request{}, &requestDecodeError{
			code: protocol.InvalidRequestCode, message: "Invalid Request",
		}
	}
	return request, nil
}

func validRequestID(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return true
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return false
	}
	switch value.(type) {
	case string, json.Number:
		return true
	default:
		return false
	}
}

func resultResponse(id json.RawMessage, result HandlerResult) ([]byte, error) {
	response := protocol.Response{JSONRPC: protocol.JSONRPCVersion, ID: id, Error: result.Error}
	if result.Error == nil {
		encoded, err := json.Marshal(result.Result)
		if err != nil {
			return nil, err
		}
		response.Result = encoded
	}
	encoded, err := json.Marshal(response)
	return encoded, err
}

func errorResponse(id json.RawMessage, code int, message string) []byte {
	encoded, _ := json.Marshal(protocol.Response{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      id,
		Error:   &protocol.ResponseError{Code: code, Message: message},
	})
	return encoded
}

func queueResponse(ctx context.Context, responses chan<- []byte, response []byte) error {
	select {
	case responses <- response:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

var requestIDPattern = regexp.MustCompile(`"id"\s*:\s*("(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)`)

func recoverID(payload []byte) json.RawMessage {
	match := requestIDPattern.FindSubmatch(payload)
	if len(match) != 2 || !json.Valid(match[1]) {
		return nil
	}
	return json.RawMessage(match[1])
}
