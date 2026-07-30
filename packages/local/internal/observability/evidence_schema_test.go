package observability

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

func TestEvidenceMigrationCreatesPrivateDurableSchema(t *testing.T) {
	service := newTestService(t)
	expected := map[string][]string{
		"approval_artifact_privacy_selectors": {
			"authorization_namespace", "artifact_id", "selector_kind",
			"digest_version", "selector_digest",
		},
		"approval_artifact_occurrences": {
			"authorization_namespace", "artifact_id",
			"identity_version", "semantic_digest_version", "state",
			"semantic_digest",
			"artifact_record_id", "accepted_at",
		},
		"evidence_reservations": {
			"authorization_namespace", "evidence_id", "subject_kind",
			"subject_id", "role", "evidence_kind", "source_mode",
			"source_kind", "source_id", "content_digest_version",
			"content_digest", "idempotency_key_hash",
			"digest_verification_state",
			"canonical_record_digest_version",
			"canonical_record_digest", "edge_id", "edge_record_id",
			"relationship_accepted_at",
		},
		"evidence_relationships": {
			"authorization_namespace", "evidence_id", "subject_kind",
			"subject_id", "role", "evidence_kind", "conclusion",
			"observed_at", "recorded_at", "source_mode", "source_kind",
			"source_id", "producer_kind", "producer_id",
			"original_capture_state", "payload_state", "payload_json",
			"payload_unavailable_reason", "payload_accepted_at",
			"payload_expired_at", "accepted_after_terminal_kind",
			"accepted_after_terminal_id", "run_id", "edge_id",
			"edge_record_id", "relationship_accepted_at",
			"superseded",
		},
		"evidence_payload_records": {
			"authorization_namespace", "evidence_id",
			"record_digest_version", "record_digest",
		},
		"evidence_supersessions": {
			"authorization_namespace", "evidence_id",
			"superseded_evidence_id",
		},
		"evidence_staging_candidates": {
			"authorization_namespace", "evidence_id", "digest_version",
			"candidate_digest", "artifact_id", "record_id", "run_id",
			"operation_id", "trace_id", "segment_id", "segment_seq",
			"capture_state", "record_payload_json", "candidate_bytes",
			"retained_bytes", "accepted_at", "expires_at",
		},
		"evidence_coverage_events": {
			"authorization_namespace", "event_id", "record_id", "run_id",
			"producer_span_id", "subject_kind", "subject_id", "role",
			"status", "accepted_at", "expires_at",
		},
		"evidence_coverage_projection": {
			"authorization_namespace", "subject_kind", "subject_id", "role",
			"status", "support_count", "first_accepted_at",
			"last_accepted_at",
		},
		"evidence_subject_revisions": {
			"authorization_namespace", "subject_kind", "subject_id",
			"revision",
		},
		"evidence_truncation_watermarks": {
			"authorization_namespace", "subject_kind", "subject_id", "role",
			"truncated_at",
		},
		"evidence_deletion_tombstones": {
			"authorization_namespace", "identity_kind", "digest_version",
			"identity_digest", "deleted_at",
		},
		"evidence_ingest_health": {
			"authorization_namespace", "code", "occurrence_count",
			"first_seen_at", "last_seen_at",
		},
	}
	for table, columns := range expected {
		actual, exists, err := tableColumns(context.Background(), service.db, table)
		if err != nil {
			t.Fatal(err)
		}
		if !exists {
			t.Errorf("missing private evidence table %s", table)
			continue
		}
		for _, column := range columns {
			if !actual[column] {
				t.Errorf("missing %s.%s", table, column)
			}
		}
	}
}

func TestEvidenceMigrationCreatesQueryAndRetentionIndexes(t *testing.T) {
	service := newTestService(t)
	for _, expected := range []struct {
		table string
		index string
	}{
		{
			"approval_artifact_privacy_selectors",
			"idx_approval_artifact_privacy_selector_lookup",
		},
		{"evidence_relationships", "idx_evidence_relationships_subject_role"},
		{"evidence_relationships", "idx_evidence_relationships_retention"},
		{"evidence_relationships", "idx_evidence_payload_retention"},
		{"evidence_supersessions", "idx_evidence_supersessions_predecessor"},
		{"evidence_staging_candidates", "idx_evidence_staging_namespace_expiry"},
		{"evidence_coverage_events", "idx_evidence_coverage_events_expiry"},
		{"evidence_coverage_events", "idx_evidence_coverage_events_retention"},
		{"evidence_coverage_projection", "idx_evidence_coverage_projection_subject"},
		{"evidence_deletion_tombstones", "idx_evidence_deletion_tombstones_digest"},
		{"evidence_truncation_watermarks", "idx_evidence_truncation_subject"},
	} {
		var count int
		if err := service.db.QueryRowContext(
			context.Background(),
			`SELECT count(*) FROM sqlite_master
			 WHERE type = 'index' AND tbl_name = ? AND name = ?`,
			expected.table,
			expected.index,
		).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Errorf(
				"missing index %s on %s",
				expected.index,
				expected.table,
			)
		}
	}
}

func TestEvidenceReservationSchemaEnforcesIdentityAndCascade(t *testing.T) {
	service := newTestService(t)
	var schemaSQL string
	if err := service.db.QueryRow(`
		SELECT sql FROM sqlite_master
		WHERE type = 'table' AND name = 'evidence_reservations'
	`).Scan(&schemaSQL); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(schemaSQL, "WITHOUT ROWID") {
		t.Fatal("evidence_reservations must use its composite identity as storage")
	}

	fixture := defaultEvidenceEdgeFixture(t)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("disposition = %#v", disposition)
	}
	if _, err := service.db.Exec(`
		DELETE FROM evidence_reservations
		WHERE authorization_namespace = ? AND evidence_id = ?
	`, localEvidenceAuthorizationNamespace, fixture.evidenceID); err != nil {
		t.Fatal(err)
	}
	assertEvidenceTableCount(t, service, "evidence_relationships", 0)
	assertEvidenceTableCount(t, service, "evidence_supersessions", 0)
}

func TestEvidenceMigrationBackfillsDigestVerificationState(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	current := evidenceSchemaStatements()[0]
	legacy := strings.Replace(current, `
			digest_verification_state TEXT NOT NULL CHECK (
				digest_verification_state IN (
					'not-required', 'pending', 'verified'
				)
			),`, "", 1)
	if legacy == current {
		t.Fatal("legacy schema fixture did not remove verification state")
	}
	if _, err := db.Exec(legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO evidence_reservations (
			authorization_namespace, evidence_id, subject_kind, subject_id,
			role, evidence_kind, source_mode, source_kind, source_id,
			content_digest_version, content_digest, idempotency_key_hash,
			canonical_record_digest_version, canonical_record_digest,
			edge_id, edge_record_id, relationship_accepted_at
		) VALUES (
			'local', 'evidence_1111111111111111', 'span',
			'1111111111111111', 'verification', 'score.report', 'reference',
			'artifact', 'artifact_source', 1,
			'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
			1,
			'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
			'edge_evidence', 'rec_evidence', '2026-07-29T12:00:00Z'
		)
	`); err != nil {
		t.Fatal(err)
	}

	service, err := newService(t.Context(), db, inMemoryMaxOpenConns)
	if err != nil {
		t.Fatal(err)
	}
	var state string
	if err := service.db.QueryRow(`
		SELECT digest_verification_state FROM evidence_reservations
		WHERE evidence_id = 'evidence_1111111111111111'
	`).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "verified" {
		t.Fatalf("backfilled verification state = %q", state)
	}
}

func TestEvidenceProjectDeletionClearsEveryPrivateTable(t *testing.T) {
	service := newTestService(t)
	statements := []string{
		`INSERT INTO evidence_reservations VALUES (
			'local', 'evidence_1111111111111111', 'span', '1111111111111111',
			'verification', 'score.report', 'reference', 'artifact',
			'artifact_source', 1, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
			'verified',
			1, 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
			'edge_evidence', 'rec_evidence', '2026-07-29T12:00:00Z'
		)`,
		`INSERT INTO evidence_relationships (
			authorization_namespace, evidence_id, subject_kind, subject_id,
			role, evidence_kind, recorded_at, source_mode, source_kind,
			source_id, producer_kind, producer_id, payload_state, run_id,
			edge_id, edge_record_id, relationship_accepted_at
		) VALUES (
			'local', 'evidence_1111111111111111', 'span', '1111111111111111',
			'verification', 'score.report', '2026-07-29T12:00:00Z',
			'reference', 'artifact', 'artifact_source', 'span',
			'2222222222222222', 'reference', 'run_evidence', 'edge_evidence',
			'rec_evidence', '2026-07-29T12:00:00Z'
		)`,
		`INSERT INTO evidence_supersessions VALUES (
			'local', 'evidence_1111111111111111', 'evidence_3333333333333333'
		)`,
		`INSERT INTO evidence_staging_candidates VALUES (
			'local', 'evidence_4444444444444444', 1,
			'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
			'artifact_staged', 'rec_staged', 'run_staged', 'run_staged', NULL,
			'seg_staged', 1, 'available', '{}', 2, 2,
			'2026-07-29T12:00:00Z',
			'2026-07-30T12:00:00Z'
		)`,
		`INSERT INTO evidence_coverage_events VALUES (
			'local', 'event_coverage', 'rec_coverage', 'run_coverage',
			'2222222222222222', 'span', '1111111111111111', 'verification',
			'not-configured', '2026-07-29T12:00:00Z',
			'2026-08-12T12:00:00Z'
		)`,
		`INSERT INTO evidence_coverage_projection VALUES (
			'local', 'span', '1111111111111111', 'verification',
			'not-configured', 1, '2026-07-29T12:00:00Z',
			'2026-07-29T12:00:00Z'
		)`,
		`INSERT INTO evidence_subject_revisions VALUES (
			'local', 'span', '1111111111111111', 1
		)`,
		`INSERT INTO evidence_truncation_watermarks VALUES (
			'local', 'span', '1111111111111111', 'verification',
			'2026-07-29T12:00:00Z'
		)`,
		`INSERT INTO evidence_deletion_tombstones VALUES (
			'local', 'span', 1,
			'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
			'2026-07-29T12:00:00Z'
		)`,
		`INSERT INTO evidence_ingest_health VALUES (
			'local', 'EVIDENCE_STAGING_EXPIRED', 1,
			'2026-07-29T12:00:00Z', '2026-07-29T12:00:00Z'
		)`,
	}
	for _, statement := range statements {
		if _, err := service.db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := service.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteEvidenceProjectRows(t.Context(), tx); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	for _, table := range evidenceTableNamesForDeletion() {
		assertEvidenceTableCount(t, service, table, 0)
	}
}
