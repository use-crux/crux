package observability

import (
	"path/filepath"
	"testing"
	"time"
)

func TestEvidencePrivacyTombstoneSurvivesRestartAndRetention(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	service, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	fixture := defaultEvidenceEdgeFixture(t)
	edge := evidenceEdgeTestRecord(t, fixture)
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("seed = %#v", disposition)
	}
	if _, err := service.DeleteRuns(t.Context(), []string{fixture.operationID}); err != nil {
		t.Fatal(err)
	}
	future := service.evidenceNow().Add(365 * 24 * time.Hour)
	if err := service.cleanupExpiredEvidenceCandidates(
		t.Context(),
		future,
	); err != nil {
		t.Fatal(err)
	}
	if err := service.cleanupExpiredEvidencePayloads(
		t.Context(),
		future,
	); err != nil {
		t.Fatal(err)
	}
	if err := service.cleanupExpiredEvidenceRelationships(
		t.Context(),
		future,
	); err != nil {
		t.Fatal(err)
	}
	if err := service.cleanupExpiredEvidenceCoverage(
		t.Context(),
		future,
	); err != nil {
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
	retry := moveEvidenceRecordToOperation(t, edge, "privacy_restart", 1)
	disposition := evidenceDisposition(t, reopened, retry)
	if disposition.Code != evidencePrivacyDeletedCode || disposition.Retryable {
		t.Fatalf("restart retry = %#v", disposition)
	}
}

func TestEvidencePrivacyDeletionRollsBackTombstoneAndEvidenceTogether(
	t *testing.T,
) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	edge := evidenceEdgeTestRecord(t, fixture)
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("seed = %#v", disposition)
	}
	if _, err := service.db.Exec(`
		CREATE TRIGGER fail_private_evidence_delete
		BEFORE DELETE ON evidence_relationships
		BEGIN
			SELECT RAISE(ABORT, 'injected privacy deletion failure');
		END
	`); err != nil {
		t.Fatal(err)
	}

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{fixture.operationID},
	); err == nil {
		t.Fatal("privacy deletion unexpectedly committed")
	}
	assertEvidenceQueryCount(
		t,
		service,
		"relationship",
		`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
		fixture.evidenceID,
		1,
	)
	assertEvidenceQueryCount(
		t,
		service,
		"operation",
		`SELECT count(*) FROM operations WHERE operation_id = ?`,
		fixture.operationID,
		1,
	)
	var tombstones int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_deletion_tombstones
	`).Scan(&tombstones); err != nil {
		t.Fatal(err)
	}
	if tombstones != 0 {
		t.Fatalf("rolled-back tombstones = %d, want 0", tombstones)
	}
}

func TestEvidencePrivacyTombstonesRetainOnlyDigests(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("seed = %#v", disposition)
	}
	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{fixture.operationID},
	); err != nil {
		t.Fatal(err)
	}
	rows, err := service.db.Query(`
		SELECT identity_digest FROM evidence_deletion_tombstones
	`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var digest string
		if err := rows.Scan(&digest); err != nil {
			t.Fatal(err)
		}
		if !contentDigestPattern.MatchString(digest) {
			t.Fatalf("private identity digest = %q", digest)
		}
		if digest == fixture.evidenceID ||
			digest == fixture.runID ||
			digest == fixture.source.ID {
			t.Fatal("privacy tombstone retained a raw identity")
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}
