package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestRunEventForwarderPostsEventsToServer(t *testing.T) {
	var mu sync.Mutex
	var received []map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/quality/run-events" {
			t.Errorf("path = %s", r.URL.Path)
		}
		var batch []map[string]any
		if err := json.NewDecoder(r.Body).Decode(&batch); err != nil {
			t.Errorf("body decode: %v", err)
		}
		mu.Lock()
		received = append(received, batch...)
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer ts.Close()

	forwarder := newRunEventForwarderForURL(ts.URL)
	if forwarder == nil {
		t.Fatal("forwarder must be constructed for an explicit URL")
	}
	forwarder.forward([]byte(`{"type":"eval:start","evaluationId":"evals.bakeoff","cells":2}`))
	forwarder.forward([]byte(`{"type":"cell:done","evaluationId":"evals.bakeoff","cell":{"caseId":"c1"}}`))
	forwarder.close()

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 2 {
		t.Fatalf("received %d events, want 2: %v", len(received), received)
	}
	if received[0]["type"] != "eval:start" || received[1]["type"] != "cell:done" {
		t.Errorf("events out of order or mangled: %v", received)
	}
}

func TestRunEventForwarderNeverBlocksOnDeadServer(t *testing.T) {
	// A server that is down must not stall the run: forward() stays
	// non-blocking and close() returns promptly.
	forwarder := newRunEventForwarderForURL("http://127.0.0.1:1") // nothing listens
	if forwarder == nil {
		t.Fatal("forwarder must be constructed for an explicit URL")
	}
	for range 1000 {
		forwarder.forward([]byte(`{"type":"cell:start","evaluationId":"e"}`))
	}
	forwarder.close() // must not hang
}

func TestRunEventForwarderCopiesScannerBuffer(t *testing.T) {
	var mu sync.Mutex
	var received []map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var batch []map[string]any
		_ = json.NewDecoder(r.Body).Decode(&batch)
		mu.Lock()
		received = append(received, batch...)
		mu.Unlock()
		w.WriteHeader(http.StatusAccepted)
	}))
	defer ts.Close()

	forwarder := newRunEventForwarderForURL(ts.URL)
	// Simulate bufio.Scanner reuse: mutate the byte slice after forwarding.
	line := []byte(`{"type":"eval:start","evaluationId":"first"}`)
	forwarder.forward(line)
	copy(line, []byte(`{"type":"eval:start","evaluationId":"XXXXX"}`))
	forwarder.close()

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 || received[0]["evaluationId"] != "first" {
		t.Errorf("forwarder must copy the line before queuing: %v", received)
	}
}
