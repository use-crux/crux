package observability

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestApprovalArtifactMigrationSecondStartupPerformsZeroWrites(
	t *testing.T,
) {
	dbPath := filepath.Join(t.TempDir(), "observability.db")
	service := openApprovalMigrationService(t, dbPath)
	record := approvalMigrationArtifactRecord(
		t,
		"approval_zero_writes",
		"decision",
		"rec_zero_writes",
		"run_zero_writes",
	)
	if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
		t.Fatalf("seed disposition = %#v", disposition)
	}
	makeApprovalArtifactsLegacyRetainedOut(
		t,
		service,
		[]string{approvalArtifactIDFromRecord(t, record)},
	)
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	first := openApprovalMigrationService(t, dbPath)
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	warnings := make([]string, 0)
	second := openApprovalMigrationServiceWithOptions(
		t,
		dbPath,
		serviceOptions{warn: func(message string) {
			warnings = append(warnings, message)
		}},
	)
	if second.approvalMigrationConverted != 0 {
		t.Fatalf(
			"second conversion count = %d, want 0",
			second.approvalMigrationConverted,
		)
	}
	var changes int
	if err := second.db.QueryRow(`SELECT total_changes()`).Scan(
		&changes,
	); err != nil {
		t.Fatal(err)
	}
	if changes != 0 {
		t.Fatalf("second startup changes = %d, want 0", changes)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("second startup warnings = %#v, want none", warnings)
	}
}

func TestApprovalArtifactMigrationFailureRollsBackEveryConversion(
	t *testing.T,
) {
	dbPath := filepath.Join(t.TempDir(), "observability.db")
	service := openApprovalMigrationService(t, dbPath)
	active := approvalMigrationArtifactRecord(
		t,
		"approval_rollback_active",
		"decision",
		"rec_rollback_active",
		"run_rollback_active",
	)
	retained := approvalMigrationArtifactRecord(
		t,
		"approval_rollback_retained",
		"request",
		"rec_rollback_retained",
		"run_rollback_retained",
	)
	for _, record := range []Record{active, retained} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("seed disposition = %#v", disposition)
		}
	}
	activeID := approvalArtifactIDFromRecord(t, active)
	retainedID := approvalArtifactIDFromRecord(t, retained)
	if _, err := service.db.Exec(
		`DELETE FROM approval_artifact_privacy_selectors`,
	); err != nil {
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

	failedDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer failedDB.Close()
	failed := &Service{
		db: failedDB,
		evidenceNow: func() time.Time {
			return time.Date(2026, 7, 30, 15, 0, 0, 0, time.UTC)
		},
	}
	injected := errors.New("injected approval migration failure")
	err = failed.migrateWithHook(t.Context(), func(step string) error {
		if step == "after-approval-privacy-migration" {
			return injected
		}
		return nil
	})
	if !errors.Is(err, injected) {
		t.Fatalf("migration error = %v, want injected failure", err)
	}

	assertApprovalSelectorCount(t, failed, activeID, 0)
	assertApprovalSelectorCount(t, failed, retainedID, 0)
	var retainedReservations int
	if err := failed.db.QueryRow(`
		SELECT count(*) FROM approval_artifact_occurrences
		WHERE artifact_id = ? AND state = 'retained-out'
	`, retainedID).Scan(&retainedReservations); err != nil {
		t.Fatal(err)
	}
	if retainedReservations != 1 {
		t.Fatalf(
			"retained-out reservations after rollback = %d, want 1",
			retainedReservations,
		)
	}
	var tombstones int
	if err := failed.db.QueryRow(`
		SELECT count(*) FROM evidence_deletion_tombstones
		WHERE identity_kind = ?
	`, approvalOccurrenceSlotIdentityKind).Scan(&tombstones); err != nil {
		t.Fatal(err)
	}
	if tombstones != 0 {
		t.Fatalf("slot tombstones after rollback = %d, want 0", tombstones)
	}
}
