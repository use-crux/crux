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

func performObservabilityIngestRequest(handler http.Handler, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/observability/records", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
