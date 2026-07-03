package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func newTestWSServer(t *testing.T, s *store.Store) http.Handler {
	t.Helper()
	return NewHTTPServer(s, ServerOptions{QualityDir: t.TempDir()})
}

func dialWS(t *testing.T, ts *httptest.Server) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws/ui"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket dial error: %v", err)
	}
	return ws
}

// drainSnapshot reads and discards initial snapshot messages.
// The server always sends at least a index message on connect.
// For empty stores, that's the only message.
func drainSnapshot(t *testing.T, ws *websocket.Conn) {
	t.Helper()
	// Read exactly the index message (always sent).
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err := ws.ReadMessage()
	if err != nil {
		t.Logf("drainSnapshot: no index message: %v", err)
	}
	// For empty stores, there are no more snapshot messages.
	// Reset deadline — caller will set their own.
	ws.SetReadDeadline(time.Time{})
}

func postObservabilityRun(t *testing.T, client *http.Client, baseURL string, runID string) {
	t.Helper()
	body := `{"records":[
		{"schemaVersion":1,"recordId":"rec_start_` + runID + `","type":"run:start","runId":"` + runID + `","traceId":"trace_` + runID + `","name":"ws","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"rec_end_` + runID + `","type":"run:end","runId":"` + runID + `","traceId":"trace_` + runID + `","endedAt":"2026-05-16T18:00:00.010Z","durationMs":10,"status":"ok"}
	]}`
	resp, err := client.Post(baseURL+"/api/observability/records", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST observability records: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST observability status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}
}

func postObservabilityTokenChunk(t *testing.T, client *http.Client, baseURL string) {
	t.Helper()
	body := `{"records":[
		{"schemaVersion":1,"recordId":"rec_token_run","type":"run:start","runId":"run_token_ws","traceId":"trace_token_ws","name":"ws tokens","rootPrimitive":"generation.stream","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"rec_token_span","type":"span:start","runId":"run_token_ws","traceId":"trace_token_ws","spanId":"span_token_ws","family":"generation","primitive":"generation.stream","name":"stream","startedAt":"2026-05-16T18:00:00.001Z","status":"running"},
		{"schemaVersion":1,"recordId":"rec_token_chunk_1","type":"span:event","runId":"run_token_ws","traceId":"trace_token_ws","spanId":"span_token_ws","eventId":"event_token_ws_1","name":"token.chunk","timestamp":"2026-05-16T18:00:00.100Z","attributes":{"chunkIndex":0,"charCount":2,"text":"Hi","firstDeltaAt":"2026-05-16T18:00:00.090Z","lastDeltaAt":"2026-05-16T18:00:00.100Z"}},
		{"schemaVersion":1,"recordId":"rec_token_chunk_2","type":"span:event","runId":"run_token_ws","traceId":"trace_token_ws","spanId":"span_token_ws","eventId":"event_token_ws_2","name":"token.chunk","timestamp":"2026-05-16T18:00:00.200Z","attributes":{"chunkIndex":1,"charCount":1,"text":"!","firstDeltaAt":"2026-05-16T18:00:00.190Z","lastDeltaAt":"2026-05-16T18:00:00.200Z"}}
	]}`
	resp, err := client.Post(baseURL+"/api/observability/records", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST observability token chunk: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST observability token status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}
}

func readObservabilityEvent(t *testing.T, ws *websocket.Conn) map[string]any {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("expected observability:event, got error: %v", err)
		}
		var envelope map[string]any
		if err := json.Unmarshal(msg, &envelope); err != nil {
			t.Fatalf("JSON decode error: %v", err)
		}
		if envelope["type"] == "observability:event" {
			event, ok := envelope["event"].(map[string]any)
			if !ok {
				t.Fatalf("observability:event missing event payload: %#v", envelope)
			}
			return event
		}
	}
}

func readQualityEvent(t *testing.T, ws *websocket.Conn) map[string]any {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("expected quality:event, got error: %v", err)
		}
		var envelope map[string]any
		if err := json.Unmarshal(msg, &envelope); err != nil {
			t.Fatalf("JSON decode error: %v", err)
		}
		if envelope["type"] == "quality:event" {
			if envelope["_tag"] != "QualityEvent" {
				t.Fatalf("quality:event missing top-level QualityEvent fields: %#v", envelope)
			}
			return envelope
		}
	}
}

func readObservabilityAndQualityEvents(t *testing.T, ws *websocket.Conn) (map[string]any, map[string]any) {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	var observabilityEvent map[string]any
	var qualityEvent map[string]any
	for observabilityEvent == nil || qualityEvent == nil {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("expected observability:event and quality:event, got error: %v", err)
		}
		var envelope map[string]any
		if err := json.Unmarshal(msg, &envelope); err != nil {
			t.Fatalf("JSON decode error: %v", err)
		}
		switch envelope["type"] {
		case "observability:event":
			event, ok := envelope["event"].(map[string]any)
			if !ok {
				t.Fatalf("observability:event missing event payload: %#v", envelope)
			}
			observabilityEvent = event
		case "quality:event":
			if envelope["_tag"] != "QualityEvent" {
				t.Fatalf("quality:event missing top-level QualityEvent fields: %#v", envelope)
			}
			qualityEvent = envelope
		}
	}
	return observabilityEvent, qualityEvent
}

func readIndexEvent(t *testing.T, ws *websocket.Conn) map[string]any {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("expected index event, got error: %v", err)
		}
		var envelope map[string]any
		if err := json.Unmarshal(msg, &envelope); err != nil {
			t.Fatalf("JSON decode error: %v", err)
		}
		if envelope["type"] == "index" {
			return envelope
		}
	}
}

func TestWebSocket_connect_and_receive_snapshot(t *testing.T) {
	s := store.NewStore()
	s.SetIndex(
		[]store.PromptMeta{{ID: "p1"}},
		[]store.ContextMeta{{ID: "c1"}},
		[]store.ToolMeta{{Name: "t1"}},
	)
	srv := newTestWSServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ws := dialWS(t, ts)
	defer ws.Close()

	// Server sends the service-owned index snapshot on connect.
	receivedTypes := make(map[string]bool)
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			break
		}
		var envelope map[string]any
		if json.Unmarshal(msg, &envelope) == nil {
			if typ, ok := envelope["type"].(string); ok {
				receivedTypes[typ] = true

				// Verify index content
				if typ == "index" {
					prompts, _ := envelope["prompts"].([]any)
					if len(prompts) != 1 {
						t.Errorf("index prompts = %d, want 1", len(prompts))
					}
				}
			}
		}
		if receivedTypes["index"] {
			break
		}
	}

	if !receivedTypes["index"] {
		t.Error("did not receive index message")
	}
}

func TestRegisteredSnapshotMessageUsesRegistryMetadata(t *testing.T) {
	s := store.NewStore()
	s.EvalStart(store.EvalStartEvent{
		EvalID:     "eval-1",
		StartedAt:  1,
		TotalCases: 1,
	})
	actualCost := 0.12
	s.RecordCostEvent("report", store.CostEvent{
		TraceID:   "trace-1",
		Timestamp: 2,
		Actual:    &actualCost,
		Entry:     map[string]any{"model": "test-model"},
	})
	qualitySvc := quality.NewService(s, quality.Dir(t.TempDir()))
	hub := &WSHub{devtools: devtools.NewService(s, qualitySvc)}

	evalMessage, ok := registeredSnapshotMessage(hub, "eval:snapshot")
	if !ok {
		t.Fatal("eval:snapshot was not built")
	}
	evalRuns, ok := evalMessage["evalRuns"].([]store.EvalRun)
	if !ok || len(evalRuns) != 1 || evalRuns[0].EvalID != "eval-1" {
		t.Fatalf("evalRuns = %#v, want eval-1", evalMessage["evalRuns"])
	}

	runtimeMessage, ok := registeredSnapshotMessage(hub, "runtime:snapshot")
	if !ok {
		t.Fatal("runtime:snapshot was not built")
	}
	costEvents, ok := runtimeMessage["costEvents"].([]store.CostEventData)
	if !ok || len(costEvents) != 1 || costEvents[0].TraceID != "trace-1" {
		t.Fatalf("costEvents = %#v, want trace-1", runtimeMessage["costEvents"])
	}
	if _, ok := runtimeMessage["indexEvents"]; !ok {
		t.Fatalf("runtime snapshot fields = %#v, want registry-provided indexEvents field", runtimeMessage)
	}
}

func TestWebSocket_broadcast_on_event(t *testing.T) {
	s := store.NewStore()
	srv := newTestWSServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ws := dialWS(t, ts)
	defer ws.Close()

	// Read and discard initial snapshot messages
	drainSnapshot(t, ws)

	postObservabilityRun(t, ts.Client(), ts.URL, "run_ws")
	event, qualityEvent := readObservabilityAndQualityEvents(t, ws)
	if event["kind"] != "observability.records" || event["action"] != "ingested" || event["refId"] != "run_ws" {
		t.Fatalf("observability event = %#v", event)
	}
	if qualityEvent["kind"] != "refresh" || qualityEvent["refId"] != "run_ws" {
		t.Fatalf("quality event = %#v", qualityEvent)
	}
}

func TestWebSocket_broadcasts_quality_run_delete(t *testing.T) {
	s := store.NewStore()
	srv := newTestWSServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ws := dialWS(t, ts)
	defer ws.Close()
	drainSnapshot(t, ws)

	postObservabilityRun(t, ts.Client(), ts.URL, "run_delete_ws")
	_ = readObservabilityEvent(t, ws)

	req, err := http.NewRequest(http.MethodDelete, ts.URL+"/api/quality/runs/run_delete_ws", nil)
	if err != nil {
		t.Fatalf("create delete request: %v", err)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("DELETE quality run: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("DELETE quality run status = %d, want 200", resp.StatusCode)
	}

	var event map[string]any
	for i := 0; i < 3; i++ {
		event = readQualityEvent(t, ws)
		if event["kind"] == "run" && event["action"] == "deleted" {
			break
		}
	}
	if event["kind"] != "run" || event["action"] != "deleted" || event["refId"] != "run_delete_ws" {
		t.Fatalf("quality delete event = %#v", event)
	}
}

func TestWebSocket_broadcasts_token_chunk_lane(t *testing.T) {
	s := store.NewStore()
	srv := newTestWSServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ws := dialWS(t, ts)
	defer ws.Close()
	drainSnapshot(t, ws)

	postObservabilityTokenChunk(t, ts.Client(), ts.URL)
	for i := 0; i < 2; i++ {
		event := readObservabilityEvent(t, ws)
		if event["kind"] != "token.chunk" {
			continue
		}
		if event["action"] != "appended" || event["refId"] != "run_token_ws" {
			t.Fatalf("token event = %#v", event)
		}
		payload, ok := event["payload"].(map[string]any)
		if !ok || payload["spanId"] != "span_token_ws" {
			t.Fatalf("token payload = %#v", event["payload"])
		}
		attrs, ok := payload["attributes"].(map[string]any)
		if !ok || attrs["text"] != "Hi!" {
			t.Fatalf("token attrs = %#v", payload["attributes"])
		}
		return
	}
	t.Fatal("did not receive token.chunk observability event")
}

func TestWebSocket_index_snapshot_broadcasts_from_service_channel(t *testing.T) {
	s := store.NewStore()
	srv := newTestWSServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ws := dialWS(t, ts)
	defer ws.Close()
	drainSnapshot(t, ws)

	body := `{
		"schemaVersion":1,
		"prompts":[{"id":"p-live"}],
		"contexts":[{"id":"c-live"}],
		"tools":[{"name":"lookup"}],
		"lintFindings":[{
			"id":"lint:tool:lookup",
			"severity":"warning",
			"ruleId":"tool.missing_input_schema",
			"category":"contracts",
			"maturity":"stable",
			"confidence":"high",
			"profiles":["recommended","strict"],
			"title":"Tool has no input schema",
			"message":"lookup has no parameters schema.",
			"rationale":"Typed tool inputs let users inspect model intent before execution.",
			"relatedDefinitionIds":["tool:lookup"],
			"evidence":[{"kind":"definition","label":"Tool definition","definitionId":"tool:lookup"}],
			"fixes":[{"kind":"manual","title":"Declare parameters","description":"Add a Zod parameters schema."}],
			"docsUrl":"/docs/reference/crux-core/index-lints/tool-missing-input-schema"
		}]
	}`
	resp, err := ts.Client().Post(ts.URL+"/api/index/snapshot", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST index snapshot: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("POST index status = %d, want %d", resp.StatusCode, http.StatusNoContent)
	}

	event := readIndexEvent(t, ws)
	prompts, _ := event["prompts"].([]any)
	if len(prompts) != 1 {
		t.Fatalf("index prompts = %#v, want one prompt", event["prompts"])
	}
	prompt, _ := prompts[0].(map[string]any)
	if prompt["id"] != "p-live" {
		t.Fatalf("index prompt = %#v, want p-live", prompt)
	}
	findings, _ := event["lintFindings"].([]any)
	if len(findings) != 1 {
		t.Fatalf("index lintFindings = %#v, want one", event["lintFindings"])
	}
	finding, _ := findings[0].(map[string]any)
	if finding["ruleId"] != "tool.missing_input_schema" || finding["rationale"] == "" {
		t.Fatalf("index lint finding = %#v, want full finding payload", finding)
	}
}

func TestWebSocket_multiple_clients(t *testing.T) {
	s := store.NewStore()
	srv := newTestWSServer(t, s)
	ts := httptest.NewServer(srv)
	defer ts.Close()

	ws1 := dialWS(t, ts)
	defer ws1.Close()
	ws2 := dialWS(t, ts)
	defer ws2.Close()

	// Read and discard initial snapshot messages
	drainSnapshot(t, ws1)
	drainSnapshot(t, ws2)

	postObservabilityRun(t, ts.Client(), ts.URL, "run_multi")

	event1 := readObservabilityEvent(t, ws1)
	event2 := readObservabilityEvent(t, ws2)
	if event1["refId"] != "run_multi" {
		t.Fatalf("client 1 event = %#v, want run_multi", event1)
	}
	if event2["refId"] != "run_multi" {
		t.Fatalf("client 2 event = %#v, want run_multi", event2)
	}
}
