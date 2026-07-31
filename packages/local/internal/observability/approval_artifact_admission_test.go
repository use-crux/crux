package observability

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestApprovalArtifactImmutableAdmissionRetainsFirstProducer(t *testing.T) {
	service := newTestService(t)
	first := approvalDecisionArtifactRecord(
		t,
		"rec_approval_first",
		"run_current_first",
		"seg_approval_first",
		1,
		map[string]any{"approved": true},
	)
	retry := approvalDecisionArtifactRecord(
		t,
		"rec_approval_retry",
		"run_current_retry",
		"seg_approval_retry",
		1,
		map[string]any{"approved": true},
	)

	for _, record := range []Record{first, retry} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("disposition = %#v", disposition)
		}
	}

	var runID string
	if err := service.db.QueryRow(
		`SELECT run_id FROM artifacts WHERE kind = 'approval.decision'`,
	).Scan(&runID); err != nil {
		t.Fatal(err)
	}
	if runID != first.RunID {
		t.Fatalf("artifact producer run = %q, want first %q", runID, first.RunID)
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 1)
	assertEvidenceTableCount(t, service, "artifacts", 1)
	assertEvidenceTableCount(t, service, "records", 1)
}

func TestApprovalArtifactImmutableAdmissionRejectsDivergentContent(t *testing.T) {
	service := newTestService(t)
	first := approvalDecisionArtifactRecord(
		t,
		"rec_approval_first",
		"run_current_first",
		"seg_approval_first",
		1,
		map[string]any{"approved": true},
	)
	if disposition := evidenceDisposition(t, service, first); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}
	divergent := approvalDecisionArtifactRecord(
		t,
		"rec_approval_divergent",
		"run_current_retry",
		"seg_approval_retry",
		1,
		map[string]any{"approved": false},
	)
	disposition := evidenceDisposition(t, service, divergent)
	if disposition.Code != evidenceIdempotencyConflictCode ||
		disposition.Retryable {
		t.Fatalf("divergent disposition = %#v", disposition)
	}
	if disposition.Message !=
		"Content diverges from the first accepted content for this evidence identity." {
		t.Fatalf("divergent message = %q", disposition.Message)
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 1)
	assertEvidenceTableCount(t, service, "artifacts", 1)
	assertEvidenceTableCount(t, service, "records", 1)
}

func TestApprovalArtifactSemanticDigestIsCanonicalAndPresenceAware(t *testing.T) {
	first := json.RawMessage(`{
		"kind":"approval.decision",
		"contentType":"application/json",
		"encoding":"json",
		"preview":null,
		"sizeBytes":0,
		"recordId":"rec_first",
		"createdAt":"2026-07-30T00:00:00Z"
	}`)
	reordered := json.RawMessage(`{
		"createdAt":"2027-01-01T00:00:00Z",
		"recordId":"rec_retry",
		"sizeBytes":0,
		"preview":null,
		"encoding":"json",
		"contentType":"application/json",
		"kind":"approval.decision"
	}`)
	left, err := approvalArtifactSemanticDigest(first)
	if err != nil {
		t.Fatal(err)
	}
	right, err := approvalArtifactSemanticDigest(reordered)
	if err != nil {
		t.Fatal(err)
	}
	if left != right {
		t.Fatalf("envelope-only changes affected semantic digest: %q != %q", left, right)
	}
	for _, different := range []json.RawMessage{
		json.RawMessage(`{"kind":"approval.decision","contentType":"application/json","encoding":"json","sizeBytes":0}`),
		json.RawMessage(`{"kind":"approval.decision","contentType":"application/json","encoding":"json","preview":null}`),
	} {
		digest, err := approvalArtifactSemanticDigest(different)
		if err != nil {
			t.Fatal(err)
		}
		if digest == left {
			t.Fatal("presence-aware semantic fields produced the same digest")
		}
	}
}

func TestApprovalArtifactImmutableAdmissionSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	first, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	record := approvalDecisionArtifactRecord(
		t,
		"rec_approval_first",
		"run_current_first",
		"seg_approval_first",
		1,
		map[string]any{"approved": true},
	)
	if disposition := evidenceDisposition(t, first, record); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	retry := approvalDecisionArtifactRecord(
		t,
		"rec_approval_retry",
		"run_current_retry",
		"seg_approval_retry",
		1,
		map[string]any{"approved": true},
	)
	if disposition := evidenceDisposition(t, reopened, retry); disposition.Outcome != "accepted" {
		t.Fatalf("retry disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, reopened, "approval_artifact_occurrences", 1)
	assertEvidenceTableCount(
		t,
		reopened,
		"approval_artifact_privacy_selectors",
		5,
	)
	assertEvidenceTableCount(t, reopened, "artifacts", 1)
	assertEvidenceTableCount(t, reopened, "records", 1)
}
