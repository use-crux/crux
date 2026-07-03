package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestParseObservabilityRunListOptionsIncludesSessionID(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/observability/runs?limit=50&offset=10&sessionId=session-1", nil)

	opts := parseObservabilityRunListOptions(request)

	if opts.Limit != 50 || opts.Offset != 10 || opts.SessionID != "session-1" {
		t.Fatalf("options = %#v", opts)
	}
}

func TestObservabilityIngestRouteReportsPartialBatchValidation(t *testing.T) {
	ctx := context.Background()
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	body := []byte(`{"records":[
		{"schemaVersion":1,"recordId":"rec_ok","type":"run:start","runId":"run_partial_route","traceId":"trace_partial_route","name":"partial","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"rec_bad","type":"span:start","runId":"run_partial_route","traceId":"trace_partial_route","spanId":"span_bad","family":"tool","primitive":"generation.call","name":"bad","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}
	]}`)

	response := performObservabilityIngestRequest(mux, body)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Accepted int `json:"accepted"`
		Rejected []struct {
			RecordID string `json:"recordId"`
			Error    string `json:"error"`
		} `json:"rejected"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Accepted != 1 || len(payload.Rejected) != 1 || payload.Rejected[0].RecordID != "rec_bad" {
		t.Fatalf("payload = %#v", payload)
	}
	if _, err := service.Run(ctx, "run_partial_route"); err != nil {
		t.Fatalf("accepted record was not ingested: %v", err)
	}
}

func TestObservabilityIngestRouteRejectsMalformedJSON(t *testing.T) {
	service, err := observability.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)

	response := performObservabilityIngestRequest(mux, []byte(`{"records":[`))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}

func TestObservabilityIngestRouteReportsTransientFailuresAsRetryable(t *testing.T) {
	ctx := context.Background()
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	body := []byte(`{"records":[
		{"schemaVersion":1,"recordId":"rec_retry","type":"run:start","runId":"run_retry_route","traceId":"trace_retry_route","name":"retry","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}
	]}`)

	response := performObservabilityIngestRequest(mux, body)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After = %q, want 1", got)
	}
}

func TestObservabilitySpanEventsRouteReadsLazyTokenChunks(t *testing.T) {
	ctx := context.Background()
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	if err := service.Ingest(ctx, observability.Batch{Records: []observability.Record{
		mustObservabilityRecord(t, `{"schemaVersion":1,"recordId":"rec_run_start","type":"run:start","runId":"run_span_events_route","traceId":"trace_span_events_route","name":"tokens","rootPrimitive":"generation.stream","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`),
		mustObservabilityRecord(t, `{"schemaVersion":1,"recordId":"rec_span_start","type":"span:start","runId":"run_span_events_route","traceId":"trace_span_events_route","spanId":"span_generate","family":"generation","primitive":"generation.stream","name":"stream","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`),
		mustObservabilityRecord(t, `{"schemaVersion":1,"recordId":"rec_token_1","type":"span:event","runId":"run_span_events_route","traceId":"trace_span_events_route","spanId":"span_generate","eventId":"event_token_1","name":"token.chunk","timestamp":"2026-05-16T18:00:00.100Z","attributes":{"chunkIndex":0,"charCount":2,"text":"Hi","firstDeltaAt":"2026-05-16T18:00:00.090Z","lastDeltaAt":"2026-05-16T18:00:00.100Z"}}`),
		mustObservabilityRecord(t, `{"schemaVersion":1,"recordId":"rec_token_2","type":"span:event","runId":"run_span_events_route","traceId":"trace_span_events_route","spanId":"span_generate","eventId":"event_token_2","name":"token.chunk","timestamp":"2026-05-16T18:00:00.200Z","attributes":{"chunkIndex":1,"charCount":1,"text":"!","firstDeltaAt":"2026-05-16T18:00:00.190Z","lastDeltaAt":"2026-05-16T18:00:00.200Z"}}`),
	}}); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/observability/runs/run_span_events_route/spans/span_generate/events?name=token.chunk&limit=1", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	var events []observability.SpanEventSummary
	if err := json.NewDecoder(response.Body).Decode(&events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].EventID != "event_token_1" || events[0].Name != "token.chunk" {
		t.Fatalf("events = %#v", events)
	}
}

func performObservabilityIngestRequest(handler http.Handler, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/observability/records", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func mustObservabilityRecord(t *testing.T, raw string) observability.Record {
	t.Helper()
	var record observability.Record
	if err := json.Unmarshal([]byte(raw), &record); err != nil {
		t.Fatal(err)
	}
	return record
}
