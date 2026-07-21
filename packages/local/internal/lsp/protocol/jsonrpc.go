// Package protocol defines the JSON-RPC and LSP wire contract supported by
// Crux P1. It contains no transport or server behavior.
package protocol

import "encoding/json"

const JSONRPCVersion = "2.0"

const (
	ParseErrorCode     = -32700
	InvalidRequestCode = -32600
	MethodNotFoundCode = -32601
	InvalidParamsCode  = -32602
	InternalErrorCode  = -32603
)

// Request is an inbound JSON-RPC request or notification. ID remains raw so
// numeric and string identifiers can be echoed byte-for-byte.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// IsNotification reports whether the message omitted an id.
func (r Request) IsNotification() bool { return len(r.ID) == 0 }

// Response is an outbound JSON-RPC result or error.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *ResponseError  `json:"error,omitempty"`
}

// ResponseError is a JSON-RPC error object.
type ResponseError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// Notification is an outbound JSON-RPC notification.
type Notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}
