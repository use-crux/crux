package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func postCanonicalEvidenceBatch(
	t *testing.T,
	baseURL string,
	records []map[string]any,
) []observability.IngestDisposition {
	t.Helper()
	canonicalPayload := map[string]any{
		"schemaVersion": 5,
		"records":       records,
	}
	raw, err := json.Marshal(canonicalPayload)
	if err != nil {
		t.Fatal(err)
	}
	var validated observability.Batch
	if err := json.Unmarshal(raw, &validated); err != nil {
		t.Fatal(err)
	}
	for _, record := range validated.Records {
		if err := observability.ValidateRecord(record); err != nil {
			t.Fatalf("%s: %v", record.RecordID, err)
		}
	}
	var response struct {
		Dispositions []observability.IngestDisposition `json:"dispositions"`
	}
	postCanonicalJSON(
		t,
		baseURL+"/api/observability/records",
		canonicalPayload,
		&response,
	)
	return response.Dispositions
}

func inspectCanonicalEvidenceHTTP(
	t *testing.T,
	baseURL string,
	request observability.EvidenceInspectRequest,
) observability.EvidenceInspectResult {
	t.Helper()
	var result observability.EvidenceInspectResult
	postCanonicalJSON(
		t,
		baseURL+"/api/observability/evidence/inspect",
		request,
		&result,
	)
	return result
}

func inspectCanonicalEvidenceDirect(
	t *testing.T,
	baseURL string,
	request observability.EvidenceInspectRequest,
) observability.EvidenceInspectResult {
	t.Helper()
	var result observability.EvidenceInspectResult
	postCanonicalJSON(
		t,
		baseURL+"/__e2e/direct/evidence",
		request,
		&result,
	)
	return result
}

func postCanonicalJSON(t *testing.T, url string, body any, target any) {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.Post(
		url,
		"application/json",
		bytes.NewReader(raw),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf("POST %s returned HTTP %d", url, response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}

func assertCanonicalEvidenceDispositions(
	t *testing.T,
	dispositions []observability.IngestDisposition,
	wantRejected int,
) {
	t.Helper()
	rejected := 0
	for _, disposition := range dispositions {
		if disposition.Retryable {
			t.Fatalf("non-final disposition = %#v", disposition)
		}
		if disposition.Outcome == "rejected" {
			rejected++
		}
	}
	if rejected != wantRejected {
		t.Fatalf(
			"rejected dispositions = %d, want %d: %#v",
			rejected,
			wantRejected,
			dispositions,
		)
	}
}

func assertCanonicalCursorInvalid(
	t *testing.T,
	baseURL string,
	request observability.EvidenceInspectRequest,
) {
	t.Helper()
	client := api.New(baseURL)
	_, err := client.InspectEvidence(context.Background(), request)
	if err == nil || !strings.Contains(err.Error(), "EVIDENCE_CURSOR_INVALID") {
		t.Fatalf("stale cursor error = %v", err)
	}
}
