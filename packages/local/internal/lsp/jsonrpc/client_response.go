package jsonrpc

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// decodeClientResponse recognizes methodless result/error envelopes before
// request decoding. A recognized malformed response is logged and discarded;
// JSON-RPC must never answer a response with another response.
func decodeClientResponse(payload []byte) (protocol.Response, bool, error) {
	if !json.Valid(payload) {
		return protocol.Response{}, false, nil
	}
	var envelope struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Method  json.RawMessage `json:"method"`
		Result  json.RawMessage `json:"result"`
		Error   json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return protocol.Response{}, false, nil
	}
	if len(envelope.Method) > 0 || (len(envelope.Result) == 0 && len(envelope.Error) == 0) {
		return protocol.Response{}, false, nil
	}
	if envelope.JSONRPC != protocol.JSONRPCVersion || len(envelope.ID) == 0 ||
		(len(envelope.Result) > 0 && len(envelope.Error) > 0) {
		return protocol.Response{}, true, fmt.Errorf("invalid response envelope")
	}
	if !validResponseID(envelope.ID) {
		return protocol.Response{}, true, fmt.Errorf("invalid response id")
	}
	response := protocol.Response{
		JSONRPC: envelope.JSONRPC,
		ID:      append(json.RawMessage(nil), envelope.ID...),
		Result:  append(json.RawMessage(nil), envelope.Result...),
	}
	if len(envelope.Error) > 0 {
		var responseError protocol.ResponseError
		if bytes.Equal(envelope.Error, []byte("null")) || json.Unmarshal(envelope.Error, &responseError) != nil {
			return protocol.Response{}, true, fmt.Errorf("invalid response error")
		}
		response.Error = &responseError
	}
	return response, true, nil
}

func validResponseID(raw json.RawMessage) bool {
	if bytes.Equal(raw, []byte("null")) {
		return true
	}
	return validRequestID(raw)
}
