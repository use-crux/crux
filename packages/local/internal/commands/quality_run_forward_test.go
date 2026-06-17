package commands

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestRunEventForwarderExposesDevtoolsURLForWorkerEnv(t *testing.T) {
	forwarder := newRunEventForwarderForURL("http://localhost:4400/")
	if forwarder == nil {
		t.Fatal("forwarder must be constructed for an explicit URL")
	}
	defer forwarder.close()

	if got, want := forwarder.devtoolsURL(), "http://localhost:4400"; got != want {
		t.Fatalf("devtoolsURL() = %q, want %q", got, want)
	}
}

func TestRunEventForwarderRejectsRemoteDevtoolsURL(t *testing.T) {
	forwarder := newRunEventForwarderForURL("https://telemetry.example.com")
	if forwarder != nil {
		forwarder.close()
		t.Fatal("forwarder must ignore non-local devtools URLs")
	}
}

func TestRunEventForwarderNormalizesLoopbackWebsocketURL(t *testing.T) {
	forwarder := newRunEventForwarderForURL("ws://127.0.0.1:4400/")
	if forwarder == nil {
		t.Fatal("forwarder must accept local websocket-style URLs")
	}
	defer forwarder.close()

	if got, want := forwarder.devtoolsURL(), "http://127.0.0.1:4400"; got != want {
		t.Fatalf("devtoolsURL() = %q, want %q", got, want)
	}
}

func TestRunEventForwarderAcceptsLoopbackOnlyOrigins(t *testing.T) {
	accepted := map[string]string{
		"http://localhost:4400":   "http://localhost:4400",
		"https://[::1]:4400/":     "https://[::1]:4400",
		"wss://127.22.33.44:4400": "https://127.22.33.44:4400",
	}
	for input, want := range accepted {
		t.Run(input, func(t *testing.T) {
			forwarder := newRunEventForwarderForURL(input)
			if forwarder == nil {
				t.Fatal("forwarder must accept loopback devtools origins")
			}
			defer forwarder.close()

			if got := forwarder.devtoolsURL(); got != want {
				t.Fatalf("devtoolsURL() = %q, want %q", got, want)
			}
		})
	}
}

func TestRunEventForwarderRejectsNonOriginDevtoolsURLs(t *testing.T) {
	rejected := []string{
		"http://user:pass@localhost:4400",
		"http://localhost:4400/api/observability/records",
		"http://localhost:4400?token=secret",
		"http://localhost:4400#fragment",
		"ftp://localhost:4400",
	}
	for _, input := range rejected {
		t.Run(input, func(t *testing.T) {
			forwarder := newRunEventForwarderForURL(input)
			if forwarder != nil {
				forwarder.close()
				t.Fatal("forwarder must reject non-origin devtools URLs")
			}
		})
	}
}

func TestWithQualityRunnerDevtoolsEnvUpsertsURL(t *testing.T) {
	env := withQualityRunnerDevtoolsEnv(
		[]string{"PATH=/bin", "CRUX_DEVTOOLS_URL=http://old.example"},
		"http://localhost:4400",
	)
	joined := strings.Join(env, "\n")
	if strings.Count(joined, "CRUX_DEVTOOLS_URL=") != 1 {
		t.Fatalf("env = %#v, want one CRUX_DEVTOOLS_URL", env)
	}
	if !strings.Contains(joined, "CRUX_DEVTOOLS_URL=http://localhost:4400") {
		t.Fatalf("env = %#v, want updated devtools URL", env)
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
