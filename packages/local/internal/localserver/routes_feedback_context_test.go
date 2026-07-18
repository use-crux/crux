package localserver

import (
	"encoding/json"
	"testing"
)

func TestReviewContextFieldCarriesCallOverrides(t *testing.T) {
	preview := json.RawMessage(`{"input":{"question":"refund"},"call":{"tenant":"acme"}}`)
	if got := string(reviewContextField(preview, "call")); got != `{"tenant":"acme"}` {
		t.Fatalf("call = %s", got)
	}
}
