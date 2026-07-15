package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/projectindex/manifeststore"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestParseObservabilityRunListOptionsIncludesSessionID(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/observability/runs/page?limit=50&offset=10&sessionId=session-1", nil)

	opts := parseObservabilityRunListOptions(request)

	if opts.Limit != 50 || opts.Offset != 10 || opts.SessionID != "session-1" {
		t.Fatalf("options = %#v", opts)
	}
}

func TestObservabilityBareRunsListRouteIsNotRegistered(t *testing.T) {
	service, err := observability.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/observability/runs", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for removed bare list route; body = %s", response.Code, response.Body.String())
	}
}

func TestRunDetailSeparatesHistoricalManifestAndCurrentCatalog(t *testing.T) {
	ctx := context.Background()
	manifestRoot := t.TempDir()
	manifestBytes, err := os.ReadFile(filepath.Join("..", "observability", "testdata", "manifest-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	manifests := manifeststore.New(manifestRoot)
	if _, err := manifests.Import(ctx, manifestBytes); err != nil {
		t.Fatal(err)
	}
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	service.WithManifestStore(manifests)
	t.Cleanup(func() { _ = service.Close() })
	var batch observability.Batch
	if err := json.Unmarshal([]byte(`{"schemaVersion":3,"records":[{"schemaVersion":3,"recordId":"record-manifest-api","type":"run:start","runId":"run-manifest-api","segmentId":"segment-manifest-api","segmentSeq":1,"name":"manifest","rootPrimitive":"run","startedAt":"2026-01-01T00:00:00.000Z","status":"running","deployment":{"projectId":"fixture","manifestId":"pim_15b48ab7fa9b323034d77aec99352109ae2a5ad1185b1f8adbd5821a7bb9c866"},"definitionRefs":[{"id":"prompt:writer","kind":"prompt","role":"resolved-prompt"}]}]}`), &batch); err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	indexStore := store.NewStore()
	indexStore.SetIndexData(store.IndexData{
		Project:     &store.ProjectIdentity{Name: "fixture"},
		Definitions: []store.ProjectDefinition{{ID: "prompt:writer", Kind: "prompt", Name: "writer", Description: "API_SECRET_MUST_NOT_LEAK"}},
	})
	catalog := devtools.NewService(indexStore, nil)
	t.Cleanup(catalog.Shutdown)
	mux := http.NewServeMux()
	registerObservabilityRoutesWithCatalog(mux, service, nil, catalog)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/observability/runs/run-manifest-api", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, want := range []string{`"manifest":`, `"resolution":"resolved"`, `"currentCatalog":`, `"label":"current-catalog"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %s: %s", want, body)
		}
	}
	if strings.Contains(body, "API_SECRET_MUST_NOT_LEAK") {
		t.Fatalf("current Catalog authored content leaked: %s", body)
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
	body := []byte(`{"schemaVersion":2,"records":[
		{"schemaVersion":2,"recordId":"rec_ok","type":"run:start","runId":"run_partial_route","segmentId":"seg_partial_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"partial","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":2,"recordId":"rec_bad","type":"span:start","runId":"run_partial_route","segmentId":"seg_partial_route","segmentSeq":2,"traceId":"11111111111111111111111111111111","spanId":"2222222222222222","family":"tool","primitive":"generation.call","name":"bad","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}
	]}`)

	response := performObservabilityIngestRequest(mux, body)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Dispositions []struct {
			Index     int    `json:"index"`
			RecordID  string `json:"recordId"`
			Outcome   string `json:"outcome"`
			Code      string `json:"code"`
			Retryable bool   `json:"retryable"`
		} `json:"dispositions"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Dispositions) != 2 ||
		payload.Dispositions[0].Index != 0 || payload.Dispositions[0].RecordID != "rec_ok" || payload.Dispositions[0].Outcome != "accepted" ||
		payload.Dispositions[1].Index != 1 || payload.Dispositions[1].RecordID != "rec_bad" || payload.Dispositions[1].Outcome != "rejected" || payload.Dispositions[1].Retryable {
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

func TestObservabilityIngestRouteBoundsRequestBytes(t *testing.T) {
	service, err := observability.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	body := bytes.Repeat([]byte(" "), maxObservabilityRequestBytes+1)

	response := performObservabilityIngestRequest(mux, body)

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", response.Code)
	}
}

func TestObservabilityIngestRouteRejectsUnsupportedBatchSchemaPerRecord(t *testing.T) {
	service, err := observability.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	body := []byte(`{"schemaVersion":4,"records":[{"recordId":"rec_future"}]}`)

	response := performObservabilityIngestRequest(mux, body)

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body = %s", response.Code, response.Body.String())
	}
	var payload observabilityIngestResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Dispositions) != 1 || payload.Dispositions[0].Index != 0 || payload.Dispositions[0].RecordID != "rec_future" ||
		payload.Dispositions[0].Code != "unsupported_schema_version" || payload.Dispositions[0].Retryable {
		t.Fatalf("payload = %#v", payload)
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
	body := []byte(`{"schemaVersion":2,"records":[
		{"schemaVersion":2,"recordId":"rec_retry","type":"run:start","runId":"run_retry_route","segmentId":"seg_retry_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"retry","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}
	]}`)

	response := performObservabilityIngestRequest(mux, body)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Retry-After"); got != "1" {
		t.Fatalf("Retry-After = %q, want 1", got)
	}
	var payload observabilityIngestResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Dispositions) != 1 || payload.Dispositions[0].Outcome != "rejected" || !payload.Dispositions[0].Retryable {
		t.Fatalf("payload = %#v, want one retryable disposition", payload)
	}
}

func TestObservabilityIngestRouteIndexesDuplicateIDs(t *testing.T) {
	ctx := context.Background()
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	body := []byte(`{"schemaVersion":2,"sourceHealth":{"sourceId":"source_route","accepted":4,"retried":2,"permanentlyRejected":1,"overflowDropped":3,"deadlineDropped":0,"lastError":{"code":"delivery_retry","message":"https://collector.example/private Bearer secret-token"}},"records":[
		{"schemaVersion":2,"recordId":"rec_duplicate_route","type":"run:start","runId":"run_duplicate_route","segmentId":"seg_duplicate_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"first","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":2,"recordId":"rec_duplicate_route","type":"run:start","runId":"run_duplicate_route","segmentId":"seg_duplicate_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"conflict","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}
	]}`)

	response := performObservabilityIngestRequest(mux, body)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body = %s", response.Code, response.Body.String())
	}
	var payload observabilityIngestResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Dispositions) != 2 || payload.Dispositions[0].Index != 0 || payload.Dispositions[0].Outcome != "accepted" ||
		payload.Dispositions[1].Index != 1 || payload.Dispositions[1].Code != "record_id_conflict" || payload.Dispositions[1].Retryable {
		t.Fatalf("payload = %#v", payload)
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
		mustObservabilityRecord(t, `{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_span_events_route","segmentId":"seg_span_events_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"tokens","rootPrimitive":"generation.stream","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`),
		mustObservabilityRecord(t, `{"schemaVersion":2,"recordId":"rec_span_start","type":"span:start","runId":"run_span_events_route","segmentId":"seg_span_events_route","segmentSeq":2,"traceId":"11111111111111111111111111111111","spanId":"span_generate","family":"generation","primitive":"generation.stream","name":"stream","startedAt":"2026-05-16T18:00:00.001Z","status":"running"}`),
		mustObservabilityRecord(t, `{"schemaVersion":2,"recordId":"rec_token_1","type":"span:event","runId":"run_span_events_route","segmentId":"seg_span_events_route","segmentSeq":3,"traceId":"11111111111111111111111111111111","spanId":"span_generate","eventId":"event_token_1","name":"token.chunk","timestamp":"2026-05-16T18:00:00.100Z","attributes":{"chunkIndex":0,"charCount":2,"text":"Hi","firstDeltaAt":"2026-05-16T18:00:00.090Z","lastDeltaAt":"2026-05-16T18:00:00.100Z"}}`),
		mustObservabilityRecord(t, `{"schemaVersion":2,"recordId":"rec_token_2","type":"span:event","runId":"run_span_events_route","segmentId":"seg_span_events_route","segmentSeq":4,"traceId":"11111111111111111111111111111111","spanId":"span_generate","eventId":"event_token_2","name":"token.chunk","timestamp":"2026-05-16T18:00:00.200Z","attributes":{"chunkIndex":1,"charCount":1,"text":"!","firstDeltaAt":"2026-05-16T18:00:00.190Z","lastDeltaAt":"2026-05-16T18:00:00.200Z"}}`),
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

	request = httptest.NewRequest(http.MethodGet, "/api/observability/runs/run_span_events_route/spans/span_generate/events?name=token.chunk&after=2026-05-16T18:00:00.100Z|event_token_1&limit=1", nil)
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	events = nil
	if err := json.NewDecoder(response.Body).Decode(&events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].EventID != "event_token_2" || events[0].Name != "token.chunk" {
		t.Fatalf("events after compound cursor = %#v", events)
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
