package api

import (
	"strings"
	"testing"
)

func TestConnectionErrorNamesCommandAndActualPort(t *testing.T) {
	client := New("http://localhost:4667").WithCommand("index")
	err := client.connectError()
	for _, want := range []string{
		"cannot connect to crux devtools at http://localhost:4667",
		"crux --port 4667 index",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error = %q, want %q", err, want)
		}
	}
	if strings.Contains(err.Error(), "8080") || strings.Contains(err.Error(), "traces") {
		t.Fatalf("error retained stale remediation: %q", err)
	}
}
