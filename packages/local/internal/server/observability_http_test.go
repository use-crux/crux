package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestObservabilityHTTPIngestAndReadGraph(t *testing.T) {
	srv := NewHTTPServer(store.NewStore(), ServerOptions{
		InspectDir:          t.TempDir(),
		ObservabilityDBPath: t.TempDir() + "/observability.sqlite",
	})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	raw := readGenerationFixture(t)
	runID, spanID := generationFixtureIDs(t, raw)
	raw = withObservabilityBatchSchemaVersion(t, raw)
	resp, err := http.Post(ts.URL+"/api/observability/records", "application/json", strings.NewReader(raw))
	if err != nil {
		t.Fatalf("POST records error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}
	var ingested struct {
		Dispositions []struct {
			Outcome string `json:"outcome"`
		} `json:"dispositions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ingested); err != nil {
		t.Fatal(err)
	}
	accepted := 0
	for _, disposition := range ingested.Dispositions {
		if disposition.Outcome == "accepted" {
			accepted++
		}
	}
	if accepted != 13 {
		t.Fatalf("accepted = %d, want 13 (dispositions = %#v)", accepted, ingested.Dispositions)
	}

	resp, err = http.Get(ts.URL + "/api/observability/runs/page")
	if err != nil {
		t.Fatalf("GET runs page error: %v", err)
	}
	defer resp.Body.Close()
	var page observability.RunsResponse
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.Revision == 0 {
		t.Fatal("page.Revision was not populated")
	}
	if len(page.Rows) != 1 || page.Rows[0].RunID != runID {
		t.Fatalf("page.Rows = %#v", page.Rows)
	}

	resp, err = http.Get(ts.URL + "/api/observability/runs/" + runID + "/graph")
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
	if graph.Run.Status != "ok" || len(graph.Spans) != 1 || len(graph.Artifacts) != 4 || len(graph.Edges) != 4 || len(graph.Events) != 1 || len(graph.Records) != 13 {
		t.Fatalf("graph = %#v", graph)
	}
	var graphWire map[string]any
	if err := json.Unmarshal(mustReadGraphBody(t, ts.URL, runID), &graphWire); err != nil {
		t.Fatal(err)
	}
	if _, ok := graphWire["run"].(map[string]any)["runId"]; !ok {
		t.Fatalf("graph JSON should use lower camel case keys: %#v", graphWire["run"])
	}

	resp, err = http.Get(ts.URL + "/api/observability/runs/" + runID)
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
	if detail.Root.SpanID != spanID || detail.SpanIndex[spanID].Placement != "node" {
		t.Fatalf("run detail = %#v", detail)
	}

}

func mustReadGraphBody(t *testing.T, baseURL string, runID string) []byte {
	t.Helper()
	resp, err := http.Get(baseURL + "/api/observability/runs/" + runID + "/graph")
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
		InspectDir:          t.TempDir(),
		ObservabilityDBPath: t.TempDir() + "/observability.sqlite",
	})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Post(ts.URL+"/api/observability/records", "application/json", strings.NewReader(`{"schemaVersion":4,"records":[{"schemaVersion":4,"recordId":"rec_bad","type":"span","runId":"run_bad","operationId":"run_bad","segmentId":"run_bad_seg","segmentSeq":1,"spanId":"span_bad","family":"tool","primitive":"generation.call","name":"bad","startedAt":"2026-05-16T18:00:00.001Z","status":"ok"}]}`))
	if err != nil {
		t.Fatalf("POST invalid records error: %v", err)
	}
	if resp.StatusCode != http.StatusAccepted {
		resp.Body.Close()
		t.Fatalf("invalid POST status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}
	var partial struct {
		Dispositions []struct {
			RecordID string `json:"recordId"`
			Outcome  string `json:"outcome"`
		} `json:"dispositions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&partial); err != nil {
		resp.Body.Close()
		t.Fatal(err)
	}
	resp.Body.Close()
	if len(partial.Dispositions) != 1 || partial.Dispositions[0].Outcome != "rejected" || partial.Dispositions[0].RecordID != "rec_bad" {
		t.Fatalf("partial invalid POST response = %#v", partial)
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
		InspectDir:          t.TempDir(),
		ObservabilityDBPath: t.TempDir() + "/observability.sqlite",
	})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	body := `{"schemaVersion":4,"records":[
		{"schemaVersion":4,"recordId":"rec_run_start","type":"run:start","runId":"run_resource","operationId":"run_resource","segmentId":"run_resource_seg","segmentSeq":1,"traceId":"trace_resource","name":"resource","rootPrimitive":"workspace.operation","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":4,"recordId":"rec_workspace","type":"span","runId":"run_resource","operationId":"run_resource","segmentId":"run_resource_seg","segmentSeq":2,"traceId":"trace_resource","spanId":"span_workspace","family":"workspace","primitive":"workspace.operation","name":"workspace.write","startedAt":"2026-05-16T18:00:00.001Z","endedAt":"2026-05-16T18:00:00.011Z","durationMs":10,"status":"ok","attributes":{"workspaceId":"drafts","operation":"write","path":"/output.md"}}
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

// withObservabilityBatchSchemaVersion stamps the shared cross-language fixture
// (which has no top-level envelope schemaVersion, since its other Go/TS
// consumers unmarshal it directly without going through the HTTP envelope
// gate) with the batch-level schemaVersion the HTTP route requires. The
// fixture's own per-record schemaVersion is already current and is left untouched.
func withObservabilityBatchSchemaVersion(t *testing.T, raw string) string {
	t.Helper()
	const marker = `"records"`
	index := strings.Index(raw, marker)
	if index == -1 {
		t.Fatal("generation fixture is missing a records field")
	}
	return raw[:index] + `"schemaVersion":4,` + raw[index:]
}

func readGenerationFixture(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("../../../core/src/observability/fixtures/generation-run.json")
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func generationFixtureIDs(t *testing.T, raw string) (string, string) {
	t.Helper()
	var batch observability.Batch
	if err := json.Unmarshal([]byte(raw), &batch); err != nil {
		t.Fatal(err)
	}
	if len(batch.Records) == 0 || batch.Records[0].RunID == "" {
		t.Fatal("generation fixture is missing run id")
	}
	for _, record := range batch.Records {
		var payload struct {
			SpanID string `json:"spanId"`
		}
		if err := json.Unmarshal(record.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.SpanID != "" {
			return batch.Records[0].RunID, payload.SpanID
		}
	}
	t.Fatal("generation fixture is missing span id")
	return "", ""
}
