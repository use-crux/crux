package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/cli/internal/observability"
	"github.com/use-crux/crux/packages/cli/internal/store"
)

func TestObservabilityHTTPIngestAndReadGraph(t *testing.T) {
	srv := NewHTTPServer(store.NewStore(), ServerOptions{
		QualityDir:          t.TempDir(),
		ObservabilityDBPath: t.TempDir() + "/observability.sqlite",
	})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	raw := readGenerationFixture(t)
	resp, err := http.Post(ts.URL+"/api/observability/records", "application/json", strings.NewReader(raw))
	if err != nil {
		t.Fatalf("POST records error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}
	var accepted struct {
		Accepted int `json:"accepted"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&accepted); err != nil {
		t.Fatal(err)
	}
	if accepted.Accepted != 9 {
		t.Fatalf("accepted = %d, want 9", accepted.Accepted)
	}

	resp, err = http.Get(ts.URL + "/api/observability/runs")
	if err != nil {
		t.Fatalf("GET runs error: %v", err)
	}
	defer resp.Body.Close()
	var runs []observability.RunSummary
	if err := json.NewDecoder(resp.Body).Decode(&runs); err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].RunID != "run_generation_fixture_01" {
		t.Fatalf("runs = %#v", runs)
	}

	resp, err = http.Get(ts.URL + "/api/observability/runs/run_generation_fixture_01/graph")
	if err != nil {
		t.Fatalf("GET graph error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET graph status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var graph observability.Graph
	if err := json.NewDecoder(resp.Body).Decode(&graph); err != nil {
		t.Fatal(err)
	}
	if graph.Run.Status != "ok" || len(graph.Spans) != 1 || len(graph.Artifacts) != 2 || len(graph.Records) != 9 {
		t.Fatalf("graph = %#v", graph)
	}
	var graphWire map[string]any
	if err := json.Unmarshal(mustReadGraphBody(t, ts.URL), &graphWire); err != nil {
		t.Fatal(err)
	}
	if _, ok := graphWire["run"].(map[string]any)["runId"]; !ok {
		t.Fatalf("graph JSON should use lower camel case keys: %#v", graphWire["run"])
	}

	resp, err = http.Get(ts.URL + "/api/observability/runs/run_generation_fixture_01")
	if err != nil {
		t.Fatalf("GET run detail error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET run detail status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var detail observability.RunDetail
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		t.Fatal(err)
	}
	if detail.Root.SpanID != "span_generation_fixture_01" || detail.SpanIndex["span_generation_fixture_01"].Placement != "node" {
		t.Fatalf("run detail = %#v", detail)
	}

}

func mustReadGraphBody(t *testing.T, baseURL string) []byte {
	t.Helper()
	resp, err := http.Get(baseURL + "/api/observability/runs/run_generation_fixture_01/graph")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestObservabilityHTTPMapsInvalidAndMissing(t *testing.T) {
	srv := NewHTTPServer(store.NewStore(), ServerOptions{
		QualityDir:          t.TempDir(),
		ObservabilityDBPath: t.TempDir() + "/observability.sqlite",
	})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/observability/records", "application/json", strings.NewReader(`{"records":[{"schemaVersion":1,"recordId":"rec_bad","type":"span","runId":"run_bad","spanId":"span_bad","family":"tool","primitive":"generation.call","name":"bad","startedAt":"2026-05-16T18:00:00.001Z","status":"ok"}]}`))
	if err != nil {
		t.Fatalf("POST invalid records error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid POST status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	resp, err = http.Get(ts.URL + "/api/observability/runs/missing")
	if err != nil {
		t.Fatalf("GET missing run error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing run status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
}

func TestObservabilityHTTPResourceActivity(t *testing.T) {
	srv := NewHTTPServer(store.NewStore(), ServerOptions{
		QualityDir:          t.TempDir(),
		ObservabilityDBPath: t.TempDir() + "/observability.sqlite",
	})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"records":[
		{"schemaVersion":1,"recordId":"rec_run_start","type":"run:start","runId":"run_resource","traceId":"trace_resource","name":"resource","rootPrimitive":"workspace.operation","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"rec_workspace","type":"span","runId":"run_resource","traceId":"trace_resource","spanId":"span_workspace","family":"workspace","primitive":"workspace.operation","name":"workspace.write","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:00.011Z","durationMs":10,"status":"ok","attributes":{"workspaceId":"drafts","operation":"write","path":"/output.md"}}
	]}`
	resp, err := http.Post(ts.URL+"/api/observability/records", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST records error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}

	resp, err = http.Get(ts.URL + "/api/observability/resources/workspace")
	if err != nil {
		t.Fatalf("GET resource activity error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var activity []observability.ResourceActivity
	if err := json.NewDecoder(resp.Body).Decode(&activity); err != nil {
		t.Fatal(err)
	}
	if len(activity) != 1 || activity[0].ResourceID != "drafts" || activity[0].Primitive != "workspace.operation" {
		t.Fatalf("activity = %#v", activity)
	}
}

func readGenerationFixture(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("../../../core/observability/fixtures/generation-run.json")
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
