package jsonrpc

import "testing"

func TestDecodeClientResponseClassifiesResponseShapes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		payload    string
		recognized bool
		wantError  bool
	}{
		{name: "result", payload: `{"jsonrpc":"2.0","id":1,"result":null}`, recognized: true},
		{name: "client error", payload: `{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"failed"}}`, recognized: true},
		{name: "string id", payload: `{"jsonrpc":"2.0","id":"request-3","result":{}}`, recognized: true},
		{name: "request", payload: `{"jsonrpc":"2.0","id":1,"method":"shutdown"}`},
		{name: "shape missing method and result", payload: `{"jsonrpc":"2.0","id":1}`},
		{name: "result and error", payload: `{"jsonrpc":"2.0","id":1,"result":null,"error":{"code":1,"message":"bad"}}`, recognized: true, wantError: true},
		{name: "invalid error", payload: `{"jsonrpc":"2.0","id":1,"error":null}`, recognized: true, wantError: true},
		{name: "invalid version", payload: `{"jsonrpc":"1.0","id":1,"result":null}`, recognized: true, wantError: true},
		{name: "invalid id", payload: `{"jsonrpc":"2.0","id":true,"result":null}`, recognized: true, wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, recognized, err := decodeClientResponse([]byte(test.payload))
			if recognized != test.recognized || (err != nil) != test.wantError {
				t.Fatalf("recognized/error = %v/%v, want %v/%v", recognized, err, test.recognized, test.wantError)
			}
		})
	}
}
