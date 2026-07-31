package localserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestRequestInspectionRouteReadsRetainedPlanningArtifact(t *testing.T) {
	service, err := observability.OpenService(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	body := []byte(`{"schemaVersion":5,"records":[
		{"schemaVersion":5,"recordId":"rec_request_run","type":"run:start","runId":"run_request_inspection","operationId":"run_request_inspection","segmentId":"seg_request_inspection","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"request inspection","rootPrimitive":"generation.call","startedAt":"2026-07-31T12:00:00Z","status":"running"},
		{"schemaVersion":5,"recordId":"rec_request_span","type":"span:start","runId":"run_request_inspection","operationId":"run_request_inspection","segmentId":"seg_request_inspection","segmentSeq":2,"traceId":"11111111111111111111111111111111","spanId":"2222222222222222","family":"generation","primitive":"generation.call","name":"request inspection","startedAt":"2026-07-31T12:00:00.001Z","status":"running"},
		{"schemaVersion":5,"recordId":"rec_request_plan","type":"artifact","runId":"run_request_inspection","operationId":"run_request_inspection","segmentId":"seg_request_inspection","segmentSeq":3,"traceId":"11111111111111111111111111111111","spanId":"2222222222222222","artifactId":"artifact_request_plan","kind":"request.plan","createdAt":"2026-07-31T12:00:00.002Z","contentType":"application/json","encoding":"json","preview":{"kind":"request.plan","receipt":{"id":"request_remote_retained","model":"model-1","inputTokens":4,"maxInputTokens":8,"measurement":"estimated","adaptations":[],"warnings":[]},"inspection":{"id":"request_remote_retained","contributions":[],"candidates":[],"breakdown":{"total":4,"attribution":"estimated","contributions":[{"contributor":"messages","tokens":4}]},"measurement":"estimated","counting":{"measurement":"estimated","attribution":"estimated","safetyMarginTokens":1,"providerOverheadTokens":1},"retryCount":0,"artifacts":[],"supportTools":[],"supportRequests":[],"linkedRequestIds":[],"retention":"requires observability retention"}},"attributes":{"requestId":"request_remote_retained"}}
	]}`)
	response := performObservabilityIngestRequest(mux, body)
	if response.Code != http.StatusAccepted || !strings.Contains(response.Body.String(), `"outcome":"accepted"`) {
		t.Fatalf("ingest status = %d: %s", response.Code, response.Body.String())
	}

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/observability/requests/inspect",
		bytes.NewReader([]byte(`{"id":"request_remote_retained"}`)),
	)
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("inspect status = %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"id":"request_remote_retained"`) ||
		!strings.Contains(response.Body.String(), `"retention":"requires observability retention"`) {
		t.Fatalf("inspection response = %s", response.Body.String())
	}
}
