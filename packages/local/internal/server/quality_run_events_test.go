package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// The quality worker's NDJSON run stream (spec 03 §2) is bridged to devtools:
// `crux quality run` POSTs each event to /api/quality/run-events and the WS
// hub broadcasts it verbatim as {type:"quality:run:event", event:{…}}.

func readRunEvent(t *testing.T, ws interface {
	SetReadDeadline(time.Time) error
	ReadMessage() (int, []byte, error)
}) map[string]any {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		_, data, err := ws.ReadMessage()
		if err != nil {
			t.Fatalf("read WS message: %v", err)
		}
		var message map[string]any
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatalf("WS message not JSON: %v", err)
		}
		if message["type"] == "quality:run:event" {
			return message
		}
	}
}

func TestQualityRunEventsBroadcastVerbatimOverWS(t *testing.T) {
	handler := newTestWSServer(t, store.NewStore())
	ts := httptest.NewServer(handler)
	defer ts.Close()

	ws := dialWS(t, ts)
	defer ws.Close()
	drainSnapshot(t, ws)

	cellDone := `{"type":"cell:done","evaluationId":"evals.bakeoff","cell":{"caseId":"c1","variantName":"default","trial":0,"status":"passed","traceIds":["run_abc"],"futureField":42}}`
	resp, err := http.Post(ts.URL+"/api/quality/run-events", "application/json", strings.NewReader(cellDone))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}

	message := readRunEvent(t, ws)
	event, ok := message["event"].(map[string]any)
	if !ok {
		t.Fatalf("message.event missing: %v", message)
	}
	if event["type"] != "cell:done" || event["evaluationId"] != "evals.bakeoff" {
		t.Errorf("event = %v", event)
	}
	cell, _ := event["cell"].(map[string]any)
	if cell == nil || cell["futureField"] != float64(42) {
		t.Errorf("event must be forwarded verbatim (unknown fields survive): %v", event)
	}
	traceIDs, _ := cell["traceIds"].([]any)
	if len(traceIDs) != 1 || traceIDs[0] != "run_abc" {
		t.Errorf("traceIds: %v", cell)
	}
}

func TestQualityRunEventsAcceptArraysAndPublishActivity(t *testing.T) {
	handler := newTestWSServer(t, store.NewStore())
	ts := httptest.NewServer(handler)
	defer ts.Close()

	ws := dialWS(t, ts)
	defer ws.Close()
	drainSnapshot(t, ws)

	batch := `[
		{"type":"eval:start","evaluationId":"evals.bakeoff","cells":2},
		{"type":"eval:done","evaluationId":"evals.bakeoff","experimentId":"01KTAAAA","gates":{"passed":true,"informational":false,"results":[]},"filteredRun":false}
	]`
	resp, err := http.Post(ts.URL+"/api/quality/run-events", "application/json", strings.NewReader(batch))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", resp.StatusCode)
	}

	first := readRunEvent(t, ws)
	if event, _ := first["event"].(map[string]any); event == nil || event["type"] != "eval:start" {
		t.Errorf("first = %v", first)
	}
	second := readRunEvent(t, ws)
	if event, _ := second["event"].(map[string]any); event == nil || event["type"] != "eval:done" {
		t.Errorf("second = %v", second)
	}

	// eval:done lands in the activity feed so the workbench shows run history.
	resp, err = http.Get(ts.URL + "/api/quality/activity?limit=10")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var activity []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&activity); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range activity {
		if entry["refId"] == "01KTAAAA" {
			found = true
		}
	}
	if !found {
		t.Errorf("eval:done must publish an activity entry: %v", activity)
	}
}

func TestQualityRunEventsRejectInvalidJSON(t *testing.T) {
	handler := newTestWSServer(t, store.NewStore())
	ts := httptest.NewServer(handler)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/quality/run-events", "application/json", strings.NewReader("not json"))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", resp.StatusCode)
	}
}

func TestQualityRunEventsExposeRunningExperimentSummaries(t *testing.T) {
	handler := newTestWSServer(t, store.NewStore())
	ts := httptest.NewServer(handler)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/quality/run-events", "application/json", strings.NewReader(`{"type":"eval:start","evaluationId":"evals.running","cells":2}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("eval:start status = %d, want 202", resp.StatusCode)
	}

	resp, err = http.Get(ts.URL + "/api/quality/experiments")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	type experimentsPage struct {
		Experiments  []map[string]any `json:"experiments"`
		Total        int              `json:"total"`
		StatusCounts struct {
			All     int `json:"all"`
			Running int `json:"running"`
		} `json:"statusCounts"`
	}
	var page experimentsPage
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.StatusCounts.Running != 1 || len(page.Experiments) != 1 || page.Experiments[0]["status"] != "running" || page.Experiments[0]["evaluationId"] != "evals.running" {
		t.Fatalf("running experiments page = %+v", page)
	}

	resp, err = http.Post(ts.URL+"/api/quality/run-events", "application/json", strings.NewReader(`{"type":"eval:done","evaluationId":"evals.running","experimentId":"01KTDONE","gates":{"passed":true}}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("eval:done status = %d, want 202", resp.StatusCode)
	}
	resp, err = http.Get(ts.URL + "/api/quality/experiments")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	page = experimentsPage{}
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 || len(page.Experiments) != 0 {
		t.Fatalf("running summaries should clear after eval:done: %+v", page)
	}
}
