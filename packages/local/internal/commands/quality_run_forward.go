package commands

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// runEventForwarder bridges the quality worker's NDJSON stream (spec 03 §2)
// to a running devtools server, which re-broadcasts every event to WS clients
// as {type:"quality:run:event", event:{…}} — live per-cell progress in
// devtools while `crux quality run|watch|promote` executes in a terminal.
//
// Strictly best-effort: a slow or dead server never blocks or fails the run.
// Events are queued non-blocking (dropped when the queue is full) and POSTed
// in batches to /api/quality/run-events.
type runEventForwarder struct {
	baseURL string
	url     string
	events  chan json.RawMessage
	done    chan struct{}
}

const runEventQueueSize = 4096
const runEventBatchMax = 256

// newRunEventForwarder detects a devtools server and returns a forwarder, or
// nil when none is reachable. Resolution: CRUX_DEVTOOLS_URL when set, else a
// quick probe of the default local server (http://localhost:4400).
func newRunEventForwarder() *runEventForwarder {
	base := os.Getenv("CRUX_DEVTOOLS_URL")
	if base == "" {
		base = "http://localhost:4400"
		client := &http.Client{Timeout: 300 * time.Millisecond}
		resp, err := client.Get(base + "/api/stats")
		if err != nil {
			return nil
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil
		}
	}
	return newRunEventForwarderForURL(base)
}

// newRunEventForwarderForURL constructs a forwarder for an explicit server
// base URL without probing (tests; CRUX_DEVTOOLS_URL).
func newRunEventForwarderForURL(base string) *runEventForwarder {
	var ok bool
	base, ok = normalizeLocalDevtoolsURL(base)
	if !ok {
		return nil
	}
	f := &runEventForwarder{
		baseURL: base,
		url:     base + "/api/quality/run-events",
		events:  make(chan json.RawMessage, runEventQueueSize),
		done:    make(chan struct{}),
	}
	go f.pump()
	return f
}

// normalizeLocalDevtoolsURL returns a loopback-only HTTP(S) origin for
// Quality auto-attach. Remote telemetry/export targets must be configured
// explicitly by project code, not inferred from the local runner environment.
func normalizeLocalDevtoolsURL(base string) (string, bool) {
	raw := strings.TrimSpace(base)
	if raw == "" {
		return "", false
	}
	raw = normalizeDevtoolsProtocol(raw)

	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", false
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false
	}
	if !isLoopbackHostname(parsed.Hostname()) {
		return "", false
	}

	return parsed.Scheme + "://" + parsed.Host, true
}

func normalizeDevtoolsProtocol(base string) string {
	if strings.HasPrefix(base, "ws://") {
		return "http://" + strings.TrimPrefix(base, "ws://")
	}
	if strings.HasPrefix(base, "wss://") {
		return "https://" + strings.TrimPrefix(base, "wss://")
	}
	return base
}

func isLoopbackHostname(hostname string) bool {
	host := strings.Trim(strings.ToLower(hostname), "[]")
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// devtoolsURL is passed to the Node quality runner so it can persist canonical
// observability graph records into the same server that receives live events.
func (f *runEventForwarder) devtoolsURL() string {
	if f == nil {
		return ""
	}
	return f.baseURL
}

// forward queues one NDJSON line. The slice is copied — callers hand over
// bufio.Scanner buffers that are reused on the next Scan.
func (f *runEventForwarder) forward(line []byte) {
	if f == nil {
		return
	}
	event := make(json.RawMessage, len(line))
	copy(event, line)
	select {
	case f.events <- event:
	default:
		// Queue full (server too slow): drop rather than stall the run.
	}
}

// close flushes queued events and waits for the pump to finish (bounded by
// the pump's per-request timeout).
func (f *runEventForwarder) close() {
	if f == nil {
		return
	}
	close(f.events)
	<-f.done
}

func (f *runEventForwarder) pump() {
	defer close(f.done)
	client := &http.Client{Timeout: 2 * time.Second}
	failures := 0
	for event, ok := <-f.events; ok; {
		batch := []json.RawMessage{event}
	drain:
		for len(batch) < runEventBatchMax {
			select {
			case next, more := <-f.events:
				if !more {
					ok = false
					break drain
				}
				batch = append(batch, next)
			default:
				break drain
			}
		}
		if failures < 3 { // a repeatedly-failing server is treated as gone
			if err := f.post(client, batch); err != nil {
				failures++
			} else {
				failures = 0
			}
		}
		if ok {
			event, ok = <-f.events
		}
	}
}

func (f *runEventForwarder) post(client *http.Client, batch []json.RawMessage) error {
	body, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	resp, err := client.Post(f.url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("run-events POST status %d", resp.StatusCode)
	}
	return nil
}

func withQualityRunnerDevtoolsEnv(env []string, devtoolsURL string) []string {
	if devtoolsURL == "" {
		return env
	}
	const key = "CRUX_DEVTOOLS_URL="
	out := append([]string{}, env...)
	entry := key + devtoolsURL
	for i, value := range out {
		if strings.HasPrefix(value, key) {
			out[i] = entry
			return out
		}
	}
	return append(out, entry)
}
