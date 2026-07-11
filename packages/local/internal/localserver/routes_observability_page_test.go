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
		mustObservabilityRecord(t, `{"schemaVersion":2,"recordId":"rec_page_start","type":"run:start","runId":"run_page_route","segmentId":"seg_page_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"paged","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`),
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
		mustObservabilityRecord(t, `{"schemaVersion":2,"recordId":"rec_delta_start","type":"run:start","runId":"run_delta_route","segmentId":"seg_delta_route","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"delta","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`),
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
