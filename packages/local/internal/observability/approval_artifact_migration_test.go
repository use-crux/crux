package observability

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestApprovalArtifactMigrationBackfillsActiveAndGuardsRetainedOut(
	t *testing.T,
) {
	dbPath := filepath.Join(t.TempDir(), "observability.db")
	service := openApprovalMigrationService(t, dbPath)
	active := approvalMigrationArtifactRecord(
		t,
		"approval_active",
		"decision",
		"rec_migration_active",
		"run_migration_active",
	)
	retained := approvalMigrationArtifactRecord(
		t,
		"approval_retained",
		"decision",
		"rec_migration_retained",
		"run_migration_retained",
	)
	for _, record := range []Record{active, retained} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("seed disposition = %#v", disposition)
		}
	}
	activeID := approvalArtifactIDFromRecord(t, active)
	retainedID := approvalArtifactIDFromRecord(t, retained)
	if _, err := service.db.Exec(`
		DELETE FROM approval_artifact_privacy_selectors
		WHERE artifact_id = ?
	`, activeID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		UPDATE approval_artifact_occurrences
		SET state = 'retained-out', semantic_digest = NULL,
			artifact_record_id = NULL, accepted_at = NULL
		WHERE artifact_id = ?
	`, retainedID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		DELETE FROM approval_artifact_privacy_selectors
		WHERE artifact_id = ? AND selector_kind <> ?
	`, retainedID, approvalSelectorBaseRun); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(
		`DELETE FROM artifacts WHERE artifact_id = ?`,
		retainedID,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(
		`DELETE FROM records WHERE record_id = ?`,
		retained.RecordID,
	); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened := openApprovalMigrationService(t, dbPath)
	t.Cleanup(func() { _ = reopened.Close() })

	assertApprovalSelectorCount(t, reopened, activeID, 5)
	assertApprovalSelectorCount(t, reopened, retainedID, 0)
	var retainedReservations int
	if err := reopened.db.QueryRow(`
		SELECT count(*) FROM approval_artifact_occurrences
		WHERE artifact_id = ?
	`, retainedID).Scan(&retainedReservations); err != nil {
		t.Fatal(err)
	}
	if retainedReservations != 0 {
		t.Fatalf("retained-out reservations = %d, want 0", retainedReservations)
	}
	assertApprovalSlotTombstone(t, reopened, retainedID)

	ordinary := approvalRunStartRecord(
		t,
		"run_after_migrated_retry",
		"seg_after_migrated_retry",
	)
	dispositions := reopened.IngestWithDispositions(
		t.Context(),
		Batch{
			SchemaVersion: SchemaVersion,
			Records:       []Record{retained, ordinary},
		},
	)
	if len(dispositions) != 2 ||
		dispositions[0].Code != evidencePrivacyDeletedCode ||
		dispositions[0].Retryable ||
		dispositions[1].Outcome != "accepted" {
		t.Fatalf("migrated retry dispositions = %#v", dispositions)
	}
	var recreated int
	if err := reopened.db.QueryRow(`
		SELECT
			(SELECT count(*) FROM records WHERE record_id = ?) +
			(SELECT count(*) FROM artifacts WHERE artifact_id = ?) +
			(SELECT count(*) FROM approval_artifact_occurrences
			 WHERE artifact_id = ?)
	`, retained.RecordID, retainedID, retainedID).Scan(&recreated); err != nil {
		t.Fatal(err)
	}
	if recreated != 0 {
		t.Fatalf("migrated retry recreated %d graph rows", recreated)
	}
}

func openApprovalMigrationService(t *testing.T, path string) *Service {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(db)
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	return service
}

func approvalMigrationArtifactRecord(
	t *testing.T,
	approvalID string,
	slot string,
	recordID string,
	runID string,
) Record {
	t.Helper()
	kind := "approval.decision"
	status := "approved"
	if slot == "request" {
		kind = "approval.request"
		status = "requested"
	}
	marker := approvalArtifactAttributes{
		ApprovalOccurrence: approvalArtifactOccurrence{
			Domain:        "crux.tool.approval",
			IdentityEpoch: 1,
			Namespace: approvalArtifactNamespace{
				OperationID: runID,
				RunID:       runID,
			},
			ApprovalID: approvalID,
			Slot:       slot,
		},
	}
	return approvalArtifactRecord(
		t,
		recordID,
		runID,
		runID,
		"seg_"+recordID,
		1,
		kind,
		marker,
		map[string]any{"status": status},
	)
}

func approvalArtifactIDFromRecord(t *testing.T, record Record) string {
	t.Helper()
	var artifact ArtifactRecord
	if err := json.Unmarshal(record.Payload, &artifact); err != nil {
		t.Fatal(err)
	}
	return artifact.ArtifactID
}

func assertApprovalSelectorCount(
	t *testing.T,
	service *Service,
	artifactID string,
	want int,
) {
	t.Helper()
	var count int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM approval_artifact_privacy_selectors
		WHERE artifact_id = ?
	`, artifactID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("selector count for %q = %d, want %d", artifactID, count, want)
	}
}

func assertApprovalSlotTombstone(
	t *testing.T,
	service *Service,
	artifactID string,
) {
	t.Helper()
	var count int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_deletion_tombstones
		WHERE identity_kind = ? AND digest_version = ?
		  AND identity_digest = ?
	`, approvalOccurrenceSlotIdentityKind,
		evidencePrivacyIdentityDigestVersion,
		evidencePrivateIdentityDigest(artifactID)).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("slot tombstones for %q = %d, want 1", artifactID, count)
	}
}
