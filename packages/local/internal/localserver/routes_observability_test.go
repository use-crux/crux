package localserver

import (
	"net/http/httptest"
	"testing"
)

func TestParseObservabilityRunListOptionsIncludesSessionID(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/observability/runs?limit=50&offset=10&sessionId=session-1", nil)

	opts := parseObservabilityRunListOptions(request)

	if opts.Limit != 50 || opts.Offset != 10 || opts.SessionID != "session-1" {
		t.Fatalf("options = %#v", opts)
	}
}
