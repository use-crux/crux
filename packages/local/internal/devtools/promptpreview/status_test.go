package promptpreview

import (
	"net/http"
	"testing"
)

func TestPromptPreviewBrowserStatusMappingIsClosed(t *testing.T) {
	tests := []struct {
		name   string
		result BrowserResponse
		want   int
	}{
		{name: "ready", result: BrowserResponse{Status: "ready"}, want: http.StatusOK},
		{
			name:   "validation",
			result: BrowserResponse{Status: "validation-error"},
			want:   http.StatusOK,
		},
		{name: "invalid", result: browserError("invalid_request", nil), want: http.StatusBadRequest},
		{name: "csrf", result: browserError("endpoint_not_allowed", nil), want: http.StatusForbidden},
		{name: "target", result: browserError("target_unavailable", nil), want: http.StatusNotFound},
		{name: "deadline", result: browserError("deadline_exceeded", nil), want: http.StatusRequestTimeout},
		{name: "catalogue", result: browserError("catalogue_changed", nil), want: http.StatusConflict},
		{name: "ambiguous", result: browserError("ambiguous_peer", nil), want: http.StatusConflict},
		{name: "disappeared", result: browserError("target_disappeared", nil), want: http.StatusConflict},
		{name: "cancelled", result: browserError("cancelled", nil), want: http.StatusConflict},
		{name: "input bound", result: browserError("input_limit_exceeded", nil), want: http.StatusRequestEntityTooLarge},
		{name: "internal", result: browserError("internal_error", nil), want: http.StatusInternalServerError},
		{name: "invalid response", result: browserError("invalid_response", nil), want: http.StatusBadGateway},
		{name: "command", result: browserError("command_failed", nil), want: http.StatusBadGateway},
		{name: "response bound", result: browserError("response_limit_exceeded", nil), want: http.StatusBadGateway},
		{name: "no peer", result: browserError("no_peer", nil), want: http.StatusServiceUnavailable},
		{name: "environment", result: browserError("environment_unavailable", nil), want: http.StatusServiceUnavailable},
		{name: "capability", result: browserError("capability_unavailable", nil), want: http.StatusServiceUnavailable},
		{name: "disconnect", result: browserError("peer_disconnected", nil), want: http.StatusServiceUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := browserStatus(test.result); got != test.want {
				t.Fatalf("browserStatus(%#v) = %d, want %d", test.result, got, test.want)
			}
		})
	}
}
