package observability

import (
	"path/filepath"
	"testing"
)

func TestEvidenceStagingRebuildsOnlyTheProvisionalShape(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	service, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		DROP TABLE evidence_staging_candidates;
		CREATE TABLE evidence_staging_candidates (
			authorization_namespace TEXT NOT NULL,
			evidence_id TEXT NOT NULL,
			digest_version INTEGER NOT NULL,
			candidate_digest TEXT NOT NULL,
			artifact_id TEXT NOT NULL,
			artifact_record_id TEXT NOT NULL,
			run_id TEXT NOT NULL,
			capture_state TEXT NOT NULL,
			preview_json TEXT,
			hash TEXT,
			size_bytes INTEGER,
			candidate_json TEXT NOT NULL,
			candidate_bytes INTEGER NOT NULL,
			accepted_at TEXT NOT NULL,
			expires_at TEXT NOT NULL
		)
	`); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	columns, exists, err := tableColumns(
		t.Context(),
		reopened.db,
		"evidence_staging_candidates",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !exists || !columns["record_payload_json"] || !columns["retained_bytes"] {
		t.Fatalf("final staging columns = %#v", columns)
	}
	if columns["candidate_json"] || columns["preview_json"] {
		t.Fatalf("provisional staging columns survived: %#v", columns)
	}
}

func TestEvidenceStagingPreservesFinalRowsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	service, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	insertFinalEvidenceStagingRow(t, service)
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	assertEvidenceTableCount(t, reopened, "evidence_staging_candidates", 1)
}

func TestEvidenceStagedArtifactPromotesAfterRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	service, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	fixture, artifact, edge := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if disposition := evidenceDisposition(t, reopened, edge); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	assertHydratedEvidence(t, reopened, fixture.evidenceID, "verified")
	assertEvidenceTableCount(t, reopened, "evidence_staging_candidates", 0)
}

func TestEvidenceStagingPurgesUnknownDigestVersionOnRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	service, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		INSERT INTO evidence_staging_candidates (
			authorization_namespace, evidence_id, digest_version,
			candidate_digest, artifact_id, record_id, run_id, operation_id,
			trace_id, segment_id, segment_seq, capture_state,
			record_payload_json, candidate_bytes, retained_bytes,
			accepted_at, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, localEvidenceAuthorizationNamespace, "evidence_1111111111111111", 999,
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"artifact_staged", "rec_staged", "run_staged", "run_staged", "",
		"seg_staged", 1, "available", "{}", 2, 2,
		"2099-07-29T12:00:00Z", "2099-07-30T12:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	assertEvidenceTableCount(t, reopened, "evidence_staging_candidates", 0)
}

func insertFinalEvidenceStagingRow(t *testing.T, service *Service) {
	t.Helper()
	if _, err := service.db.Exec(`
		INSERT INTO evidence_staging_candidates (
			authorization_namespace, evidence_id, digest_version,
			candidate_digest, artifact_id, record_id, run_id, operation_id,
			trace_id, segment_id, segment_seq, capture_state,
			record_payload_json, candidate_bytes, retained_bytes,
			accepted_at, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, localEvidenceAuthorizationNamespace, "evidence_1111111111111111",
		evidenceCandidateDigestVersion,
		"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"artifact_staged", "rec_staged", "run_staged", "run_staged", "",
		"seg_staged", 1, "available", "{}", 2, 2,
		"2099-07-29T12:00:00Z", "2099-07-30T12:00:00Z"); err != nil {
		t.Fatal(err)
	}
}
