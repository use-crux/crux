package api

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"
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

func TestUnavailableServerFailsWithinOneSecond(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}

	client := New("http://" + address).WithCommand("stats")
	started := time.Now()
	err = client.GetJSON(context.Background(), "/api/stats", &struct{}{})
	if elapsed := time.Since(started); elapsed >= time.Second {
		t.Fatalf("unavailable server failed after %s, want <1s", elapsed)
	}
	if err == nil || !strings.Contains(err.Error(), "Start the server first") {
		t.Fatalf("error = %v, want connection remediation", err)
	}
}
