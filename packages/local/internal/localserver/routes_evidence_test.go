package localserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestEvidenceInspectRouteUsesCanonicalInspectorAndRejectsBearerCredentials(
	t *testing.T,
) {
	service, err := observability.OpenService(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	var edge observability.Record
	if err := json.Unmarshal([]byte(`{
		"schemaVersion":5,
		"recordId":"rec_route_evidence",
		"type":"edge",
		"operationId":"run_route_evidence",
		"runId":"run_route_evidence",
		"segmentId":"seg_route_evidence",
		"segmentSeq":1,
		"edgeId":"edge_route_evidence",
		"edgeType":"evidence.for",
		"from":{"kind":"artifact","id":"artifact_route_evidence"},
		"to":{"kind":"span","id":"2222222222222222"},
		"createdAt":"2026-07-29T12:00:00Z",
		"attributes":{
			"evidenceId":"evidence_1111111111111111",
			"role":"verification",
			"evidenceKind":"score.report",
			"conclusion":"passed",
			"recordedAt":"2026-07-29T12:00:00Z",
			"producer":{"kind":"span","id":"3333333333333333"},
			"captureState":"reference",
			"sourceMode":"reference"
		}
	}`), &edge); err != nil {
		t.Fatal(err)
	}
	dispositions := service.IngestWithDispositions(
		t.Context(),
		observability.Batch{
			SchemaVersion: observability.SchemaVersion,
			Records:       []observability.Record{edge},
		},
	)
	if dispositions[0].Outcome != "accepted" {
		t.Fatalf("ingest = %#v", dispositions)
	}

	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	body := []byte(`{
		"subject":{"kind":"execution","id":"2222222222222222"},
		"role":"verification",
		"limit":1,
		"includeHistory":false,
		"includeData":false
	}`)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/observability/evidence/inspect",
		bytes.NewReader(body),
	)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("inspect status = %d: %s", response.Code, response.Body)
	}
	var result observability.EvidenceInspectResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Roles.Verification.Status != "present" ||
		len(result.Roles.Verification.Records) != 1 {
		t.Fatalf("inspect result = %#v", result)
	}
	if !strings.Contains(response.Body.String(), `"supersedes":[]`) {
		t.Fatalf("response emitted nullable supersedes: %s", response.Body)
	}
	canonical, err := service.InspectEvidence(
		t.Context(),
		observability.EvidenceInspectRequest{
			Subject: observability.EvidenceInspectSubject{
				Kind: "execution",
				ID:   "2222222222222222",
			},
			Role:  "verification",
			Limit: 1,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result, canonical) {
		t.Fatalf("HTTP result diverged from canonical inspector")
	}

	for name, authorization := range map[string]string{
		"ingest bearer": "Bearer ingest-only",
		"other bearer":  "Bearer other-token",
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/observability/evidence/inspect",
				bytes.NewReader(body),
			)
			request.Header.Set("Authorization", authorization)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d",
					response.Code, http.StatusUnauthorized)
			}
		})
	}
}

func TestEvidenceInspectRouteRejectsOversizedBody(t *testing.T) {
	service, err := observability.OpenService(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/observability/evidence/inspect",
		strings.NewReader(`{"padding":"`+strings.Repeat("x", 17*1024)+`"}`),
	)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestEvidenceInspectRouteDoesNotMisclassifyStorageFailures(t *testing.T) {
	service, err := observability.OpenService(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/observability/evidence/inspect",
		strings.NewReader(`{
			"subject":{"kind":"execution","id":"2222222222222222"},
			"role":"verification",
			"limit":50,
			"includeHistory":false,
			"includeData":false
		}`),
	)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError ||
		!strings.Contains(response.Body.String(), "EVIDENCE_QUERY_FAILED") {
		t.Fatalf("response = %d %s", response.Code, response.Body)
	}
}

func TestEvidenceBatchReadRoutesArePositionalAndRejectBearers(t *testing.T) {
	service, err := observability.OpenService(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)

	for _, testCase := range []struct {
		path string
		body string
	}{
		{
			path: "/api/observability/evidence/subjects/summary",
			body: `{"subjects":[]}`,
		},
		{
			path: "/api/observability/evidence/navigation/resolve",
			body: `{"refs":[]}`,
		},
	} {
		request := httptest.NewRequest(
			http.MethodPost,
			testCase.path,
			strings.NewReader(testCase.body),
		)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != http.StatusOK ||
			response.Body.String() != "{\"results\":[]}\n" {
			t.Fatalf(
				"%s response = %d %s",
				testCase.path,
				response.Code,
				response.Body,
			)
		}

		request = httptest.NewRequest(
			http.MethodPost,
			testCase.path,
			strings.NewReader(testCase.body),
		)
		request.Header.Set("Authorization", "Bearer ingest-only")
		response = httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf(
				"%s bearer status = %d",
				testCase.path,
				response.Code,
			)
		}
	}
}

func TestEvidenceBatchReadRoutesRejectOversizedArrays(t *testing.T) {
	service, err := observability.OpenService(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	subjects := strings.Repeat(
		`{"kind":"execution","id":"run_x"},`,
		101,
	)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/observability/evidence/subjects/summary",
		strings.NewReader(`{"subjects":[`+
			strings.TrimSuffix(subjects, ",")+`]}`),
	)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest ||
		!strings.Contains(response.Body.String(), "EVIDENCE_INPUT_INVALID") {
		t.Fatalf("oversized response = %d %s", response.Code, response.Body)
	}
}
