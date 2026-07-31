package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestClientInspectEvidenceUsesCanonicalLocalEndpoint(t *testing.T) {
	var received observability.EvidenceInspectRequest
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost ||
				r.URL.Path != "/api/observability/evidence/inspect" {
				t.Fatalf("request = %s %s", r.Method, r.URL.Path)
			}
			if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
				t.Fatal(err)
			}
			_ = json.NewEncoder(w).Encode(emptyEvidenceInspectResult(
				received.Subject,
			))
		},
	))
	t.Cleanup(server.Close)
	request := observability.EvidenceInspectRequest{
		Subject: observability.EvidenceInspectSubject{
			Kind: "execution",
			ID:   "2222222222222222",
		},
		Role:           "verification",
		Limit:          7,
		Cursor:         "opaque",
		IncludeHistory: true,
		IncludeData:    true,
	}

	result, err := New(server.URL).InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if received != request ||
		result.Subject != request.Subject ||
		result.Roles.Verification.Role != "verification" {
		t.Fatalf("request/result = %#v / %#v", received, result)
	}
}

func TestClientEvidenceBatchReadsUseCanonicalLocalEndpoints(t *testing.T) {
	paths := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			paths = append(paths, r.URL.Path)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"results": []any{},
			})
		},
	))
	t.Cleanup(server.Close)
	client := New(server.URL)
	if _, err := client.SummarizeEvidenceSubjects(
		t.Context(),
		observability.EvidenceSubjectSummaryRequest{},
	); err != nil {
		t.Fatal(err)
	}
	if _, err := client.ResolveEvidenceNavigation(
		t.Context(),
		observability.EvidenceNavigationRequest{},
	); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"/api/observability/evidence/subjects/summary",
		"/api/observability/evidence/navigation/resolve",
	}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("paths = %#v, want %#v", paths, want)
	}
}

func emptyEvidenceInspectResult(
	subject observability.EvidenceInspectSubject,
) observability.EvidenceInspectResult {
	role := func(value string) observability.EvidenceInspectRole {
		return observability.EvidenceInspectRole{
			Role:    value,
			Records: []observability.EvidenceInspectRecord{},
		}
	}
	return observability.EvidenceInspectResult{
		Subject: subject,
		Roles: observability.EvidenceInspectRoles{
			Intent:       role("intent"),
			Authority:    role("authority"),
			Change:       role("change"),
			Verification: role("verification"),
			Recovery:     role("recovery"),
		},
	}
}
