package localserver

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestParseObservabilityRunListOptionsIncludesFiltersAndCursor(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/observability/runs/page?status=ok,error&since=2026-01-01T00:00:00.000Z&until=2026-02-01T00:00:00.000Z&cursor=abc123", nil)

	opts := parseObservabilityRunListOptions(request)

	if len(opts.Status) != 2 || opts.Status[0] != "ok" || opts.Status[1] != "error" {
		t.Fatalf("status = %#v", opts.Status)
	}
	if opts.Since != "2026-01-01T00:00:00.000Z" || opts.Until != "2026-02-01T00:00:00.000Z" {
		t.Fatalf("since/until = %q/%q", opts.Since, opts.Until)
	}
	if opts.Cursor != "abc123" {
		t.Fatalf("cursor = %q", opts.Cursor)
	}
}

func TestObservabilityRunsPageRouteServesJoinedRevisionedResponse(t *testing.T) {
	ctx := context.Background()
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)

	if err := service.Ingest(ctx, observability.Batch{Records: []observability.Record{
		mustObservabilityRecord(t, `{"schemaVersion":4,"recordId":"rec_page_start","type":"run:start","runId":"run_page_route","operationId":"run_page_route","segmentId":"seg_page_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"paged","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`),
	}}); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/observability/runs/page", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	var page observability.RunsResponse
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if page.Revision == 0 {
		t.Fatal("page.Revision was not populated")
	}
	if len(page.Rows) != 1 || page.Rows[0].RunID != "run_page_route" {
		t.Fatalf("rows = %#v", page.Rows)
	}
	if page.Rows[0].Revision == 0 {
		t.Fatal("row revision was not populated over HTTP")
	}
	if page.Rows[0].DeliveryHealth == nil || page.Rows[0].DeliveryHealth.Status != "unknown" {
		t.Fatalf("delivery health = %#v", page.Rows[0].DeliveryHealth)
	}
}

func TestObservabilityRunsDeltaRouteReturnsBoundedCatchUp(t *testing.T) {
	ctx := context.Background()
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)

	base, err := service.CurrentRevision(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, observability.Batch{Records: []observability.Record{
		mustObservabilityRecord(t, `{"schemaVersion":4,"recordId":"rec_delta_start","type":"run:start","runId":"run_delta_route","operationId":"run_delta_route","segmentId":"seg_delta_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"delta","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`),
	}}); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/observability/runs/delta?since=%d", base), nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.Code, response.Body.String())
	}
	var delta observability.RunsDelta
	if err := json.NewDecoder(response.Body).Decode(&delta); err != nil {
		t.Fatal(err)
	}
	if delta.Expired {
		t.Fatal("delta unexpectedly expired")
	}
	if len(delta.Changes) != 1 || delta.Changes[0].ID != "run_delta_route" {
		t.Fatalf("changes = %#v", delta.Changes)
	}
}

func TestObservabilityRoutesProjectDurableChildrenAsOneOperation(t *testing.T) {
	ctx := context.Background()
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)

	body := []byte(`{"schemaVersion":4,"records":[
		{"schemaVersion":4,"recordId":"family-root-start","type":"run:start","runId":"operation-family","operationId":"operation-family","segmentId":"root-segment","segmentSeq":1,"traceId":"family-trace","name":"request","rootPrimitive":"agent.run","startedAt":"2026-07-20T12:00:00Z","status":"running"},
		{"schemaVersion":4,"recordId":"family-trigger","type":"span","runId":"operation-family","operationId":"operation-family","segmentId":"root-segment","segmentSeq":2,"traceId":"family-trace","spanId":"trigger-span","family":"flow","primitive":"flow.run","name":"fan-out","startedAt":"2026-07-20T12:00:00.100Z","endedAt":"2026-07-20T12:00:00.200Z","durationMs":100,"status":"ok"},
		{"schemaVersion":4,"recordId":"family-child-a-start","type":"run:start","runId":"family-child-a","operationId":"operation-family","parentRunId":"operation-family","triggeredBySpanId":"trigger-span","segmentId":"child-a-segment","segmentSeq":1,"traceId":"family-trace","name":"child a","rootPrimitive":"flow.run","startedAt":"2026-07-20T12:00:01Z","status":"running"},
		{"schemaVersion":4,"recordId":"family-child-a-end","type":"run:end","runId":"family-child-a","operationId":"operation-family","segmentId":"child-a-segment","segmentSeq":2,"traceId":"family-trace","endedAt":"2026-07-20T12:00:02Z","status":"ok"},
		{"schemaVersion":4,"recordId":"family-child-b-start","type":"run:start","runId":"family-child-b","operationId":"operation-family","parentRunId":"operation-family","triggeredBySpanId":"trigger-span","segmentId":"child-b-segment","segmentSeq":1,"traceId":"family-trace","name":"child b","rootPrimitive":"flow.run","startedAt":"2026-07-20T12:00:01Z","status":"running"},
		{"schemaVersion":4,"recordId":"family-child-b-end","type":"run:end","runId":"family-child-b","operationId":"operation-family","segmentId":"child-b-segment","segmentSeq":2,"traceId":"family-trace","endedAt":"2026-07-20T12:00:02Z","status":"error"},
		{"schemaVersion":4,"recordId":"family-root-end","type":"run:end","runId":"operation-family","operationId":"operation-family","segmentId":"root-segment","segmentSeq":3,"traceId":"family-trace","endedAt":"2026-07-20T12:00:03Z","status":"ok"}
	]}`)
	response := performObservabilityIngestRequest(mux, body)
	if response.Code != http.StatusAccepted {
		t.Fatalf("ingest status = %d, body = %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/observability/runs/page", nil))
	var page observability.RunsResponse
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || len(page.Rows) != 1 {
		t.Fatalf("runs page status=%d rows=%#v", response.Code, page.Rows)
	}
	row := page.Rows[0]
	if row.OperationID != "operation-family" || row.ChildRunCount != 2 || row.FailedChildCount != 1 || row.TopologyHealth != "healthy" {
		t.Fatalf("operation row = %#v", row)
	}

	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/observability/runs/operation-family", nil))
	var detail observability.RunDetail
	if err := json.NewDecoder(response.Body).Decode(&detail); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || len(detail.MemberRuns) != 3 {
		t.Fatalf("operation detail status=%d members=%#v", response.Code, detail.MemberRuns)
	}
}

func TestObservabilityRunsDeltaRouteRejectsInvalidSince(t *testing.T) {
	service, err := observability.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)

	request := httptest.NewRequest(http.MethodGet, "/api/observability/runs/delta?since=not-a-number", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}
