package observability

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestApprovalArtifactMigrationGuardsLegacySlotsIndependently(
	t *testing.T,
) {
	for _, testCase := range []struct {
		name  string
		slots []string
	}{
		{name: "request only", slots: []string{"request"}},
		{name: "decision only", slots: []string{"decision"}},
		{name: "request and decision", slots: []string{"request", "decision"}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			dbPath := filepath.Join(t.TempDir(), "observability.db")
			service := openApprovalMigrationService(t, dbPath)
			artifactIDs := make([]string, 0, len(testCase.slots))
			for index, slot := range testCase.slots {
				record := approvalMigrationArtifactRecord(
					t,
					"approval_shared",
					slot,
					fmt.Sprintf("rec_migration_%s_%d", slot, index),
					"run_migration_shared",
				)
				if disposition := evidenceDisposition(
					t,
					service,
					record,
				); disposition.Outcome != "accepted" {
					t.Fatalf("seed disposition = %#v", disposition)
				}
				artifactIDs = append(
					artifactIDs,
					approvalArtifactIDFromRecord(t, record),
				)
			}
			makeApprovalArtifactsLegacyRetainedOut(
				t,
				service,
				artifactIDs,
			)
			if err := service.Close(); err != nil {
				t.Fatal(err)
			}

			warnings := make([]string, 0, 1)
			reopened := openApprovalMigrationServiceWithOptions(
				t,
				dbPath,
				serviceOptions{
					warn: func(message string) {
						warnings = append(warnings, message)
					},
				},
			)
			t.Cleanup(func() { _ = reopened.Close() })
			for _, artifactID := range artifactIDs {
				assertApprovalSlotTombstone(t, reopened, artifactID)
				assertApprovalSelectorCount(t, reopened, artifactID, 0)
			}
			assertEvidenceTableCount(
				t,
				reopened,
				"approval_artifact_occurrences",
				0,
			)
			if len(warnings) != 1 ||
				!strings.Contains(
					warnings[0],
					fmt.Sprintf("%d retained-out occurrence", len(artifactIDs)),
				) {
				t.Fatalf("migration warnings = %#v", warnings)
			}
		})
	}
}

func TestApprovalArtifactMigrationPreservesExistingSlotTombstone(
	t *testing.T,
) {
	dbPath := filepath.Join(t.TempDir(), "observability.db")
	service := openApprovalMigrationService(t, dbPath)
	record := approvalMigrationArtifactRecord(
		t,
		"approval_existing_tombstone",
		"request",
		"rec_existing_tombstone",
		"run_existing_tombstone",
	)
	if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
		t.Fatalf("seed disposition = %#v", disposition)
	}
	artifactID := approvalArtifactIDFromRecord(t, record)
	makeApprovalArtifactsLegacyRetainedOut(t, service, []string{artifactID})
	const originalDeletedAt = "2026-01-01T00:00:00Z"
	identity := approvalOccurrenceSlotIdentity(artifactID)
	if _, err := service.db.Exec(`
		INSERT INTO evidence_deletion_tombstones (
			authorization_namespace, identity_kind, digest_version,
			identity_digest, deleted_at
		) VALUES (?, ?, ?, ?, ?)
	`, localEvidenceAuthorizationNamespace, identity.kind,
		evidencePrivacyIdentityDigestVersion,
		evidencePrivateIdentityDigest(identity.id),
		originalDeletedAt); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened := openApprovalMigrationService(t, dbPath)
	t.Cleanup(func() { _ = reopened.Close() })
	var deletedAt string
	if err := reopened.db.QueryRow(`
		SELECT deleted_at FROM evidence_deletion_tombstones
		WHERE identity_kind = ? AND identity_digest = ?
	`, identity.kind, evidencePrivateIdentityDigest(identity.id)).Scan(
		&deletedAt,
	); err != nil {
		t.Fatal(err)
	}
	if deletedAt != originalDeletedAt {
		t.Fatalf("existing tombstone timestamp = %q", deletedAt)
	}
}

func openApprovalMigrationServiceWithOptions(
	t *testing.T,
	path string,
	options serviceOptions,
) *Service {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	service, err := newServiceWithOptions(
		t.Context(),
		db,
		inMemoryMaxOpenConns,
		options,
	)
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	return service
}

func makeApprovalArtifactsLegacyRetainedOut(
	t *testing.T,
	service *Service,
	artifactIDs []string,
) {
	t.Helper()
	for _, artifactID := range artifactIDs {
		if _, err := service.db.Exec(`
			UPDATE approval_artifact_occurrences
			SET state = 'retained-out', semantic_digest = NULL,
				artifact_record_id = NULL, accepted_at = NULL
			WHERE artifact_id = ?
		`, artifactID); err != nil {
			t.Fatal(err)
		}
		if _, err := service.db.Exec(`
			DELETE FROM approval_artifact_privacy_selectors
			WHERE artifact_id = ?
		`, artifactID); err != nil {
			t.Fatal(err)
		}
		if _, err := service.db.Exec(
			`DELETE FROM artifacts WHERE artifact_id = ?`,
			artifactID,
		); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := service.db.Exec(`DELETE FROM records`); err != nil {
		t.Fatal(err)
	}
}
