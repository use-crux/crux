package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"
)

func TestEvidenceArtifactStagesWithoutClaimingGenericIdentity(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	service := newEvidenceStagingTestService(t, func() time.Time { return now })
	record := evidenceSourceArtifactTestRecord(t)

	disposition := evidenceDisposition(t, service, record)
	if disposition.Outcome != "accepted" {
		t.Fatalf("disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 1)
	assertEvidenceTableCount(t, service, "records", 0)
	assertEvidenceTableCount(t, service, "artifacts", 0)

	var acceptedAt, expiresAt, payload string
	var candidateBytes, retainedBytes int
	if err := service.db.QueryRow(`
		SELECT accepted_at, expires_at, record_payload_json,
			candidate_bytes, retained_bytes
		FROM evidence_staging_candidates
	`).Scan(
		&acceptedAt,
		&expiresAt,
		&payload,
		&candidateBytes,
		&retainedBytes,
	); err != nil {
		t.Fatal(err)
	}
	if acceptedAt != formatEvidenceAcceptanceTime(now) ||
		expiresAt != formatEvidenceAcceptanceTime(
			now.Add(service.evidenceSettings.StagingTTL),
		) {
		t.Fatalf("staging interval = %q to %q", acceptedAt, expiresAt)
	}
	if payload != string(record.Payload) || retainedBytes != len(record.Payload) {
		t.Fatal("staging did not retain the exact submitted artifact record")
	}
	if candidateBytes <= 0 || candidateBytes > evidenceCandidateMaxBytes {
		t.Fatalf("candidate bytes = %d", candidateBytes)
	}
}

func TestEvidenceArtifactDuplicateDoesNotRefreshStagingTTL(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	service := newEvidenceStagingTestService(t, func() time.Time { return now })
	record := evidenceSourceArtifactTestRecord(t)
	if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}

	now = now.Add(time.Hour)
	if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
		t.Fatalf("retry disposition = %#v", disposition)
	}

	var acceptedAt, expiresAt string
	if err := service.db.QueryRow(`
		SELECT accepted_at, expires_at FROM evidence_staging_candidates
	`).Scan(&acceptedAt, &expiresAt); err != nil {
		t.Fatal(err)
	}
	wantAccepted := now.Add(-time.Hour)
	if acceptedAt != formatEvidenceAcceptanceTime(wantAccepted) ||
		expiresAt != formatEvidenceAcceptanceTime(
			wantAccepted.Add(service.evidenceSettings.StagingTTL),
		) {
		t.Fatalf("duplicate refreshed staging TTL: %q to %q", acceptedAt, expiresAt)
	}
}

func TestEvidenceArtifactAllowsDistinctCandidatesForOneArtifactID(t *testing.T) {
	service := newEvidenceStagingTestService(t, time.Now)
	first := evidenceSourceArtifactTestRecord(t)
	second := mutateEvidenceArtifactPreview(t, first, map[string]any{"review": 2})
	second = mutateEvidenceArtifactRecordID(
		t,
		second,
		"rec_evidence_artifact_second",
	)

	for _, record := range []Record{first, second} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("disposition = %#v", disposition)
		}
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 2)
}

func TestEvidenceStagingProtectsRecordIDIdentity(t *testing.T) {
	service := newEvidenceStagingTestService(t, time.Now)
	first := evidenceSourceArtifactTestRecord(t)
	if disposition := evidenceDisposition(t, service, first); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}
	conflict := mutateEvidenceArtifactPreview(
		t,
		first,
		map[string]any{"different": true},
	)
	disposition := evidenceDisposition(t, service, conflict)
	if disposition.Code != "record_id_conflict" || disposition.Retryable {
		t.Fatalf("conflict disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 1)
}

func newEvidenceStagingTestService(
	t *testing.T,
	now func() time.Time,
) *Service {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	service, err := newServiceWithOptions(
		context.Background(),
		db,
		inMemoryMaxOpenConns,
		serviceOptions{
			evidenceNow: now,
			evidenceSettings: &evidenceSettings{
				RelationshipRetention: 48 * time.Hour,
				PayloadRetention:      48 * time.Hour,
				StagingTTL:            24 * time.Hour,
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func mutateEvidenceArtifactPreview(
	t *testing.T,
	record Record,
	preview any,
) Record {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["preview"] = preview
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	record.Payload = encoded
	return record
}

func mutateEvidenceArtifactRecordID(
	t *testing.T,
	record Record,
	recordID string,
) Record {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["recordId"] = recordID
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	record.RecordID = recordID
	record.Payload = encoded
	return record
}

func mutateEvidenceArtifactIdentity(
	t *testing.T,
	record Record,
	evidenceID string,
	artifactID string,
	recordID string,
) Record {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["artifactId"] = artifactID
	payload["recordId"] = recordID
	attributes := payload["attributes"].(map[string]any)
	marker := attributes["evidenceSource"].(map[string]any)
	marker["evidenceId"] = evidenceID
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	record.RecordID = recordID
	record.Payload = encoded
	return record
}

func mutateRecordSegmentSequence(
	t *testing.T,
	record Record,
	sequence int,
) Record {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["segmentSeq"] = sequence
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	record.SegmentSeq = sequence
	record.Payload = encoded
	return record
}
