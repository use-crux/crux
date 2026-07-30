package observability

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func TestEvidenceReservationRecomputesAndPersistsReferenceRelationship(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	acceptedAt := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	service, err := newServiceWithOptions(
		context.Background(),
		db,
		inMemoryMaxOpenConns,
		serviceOptions{evidenceNow: func() time.Time { return acceptedAt }},
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture := defaultEvidenceEdgeFixture(t)
	disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, fixture))
	if disposition.Outcome != "accepted" {
		t.Fatalf("disposition = %#v", disposition)
	}

	var namespace, digest, subjectKind, subjectID, producerKind, producerID string
	var accepted, payloadState string
	if err := service.db.QueryRow(`
		SELECT r.authorization_namespace, r.content_digest,
			e.subject_kind, e.subject_id, e.producer_kind, e.producer_id,
			e.relationship_accepted_at, e.payload_state
		FROM evidence_reservations r
		JOIN evidence_relationships e
		  ON e.authorization_namespace = r.authorization_namespace
		 AND e.evidence_id = r.evidence_id
		WHERE r.evidence_id = ?
	`, fixture.evidenceID).Scan(
		&namespace,
		&digest,
		&subjectKind,
		&subjectID,
		&producerKind,
		&producerID,
		&accepted,
		&payloadState,
	); err != nil {
		t.Fatal(err)
	}
	if namespace != localEvidenceAuthorizationNamespace ||
		digest != fixture.digest ||
		subjectKind != fixture.subject.Kind ||
		subjectID != fixture.subject.ID ||
		producerKind != fixture.producer.Kind ||
		producerID != fixture.producer.ID ||
		accepted != formatEvidenceAcceptanceTime(acceptedAt) ||
		payloadState != "reference" {
		t.Fatalf("persisted relationship = %q/%q/%q:%q/%q:%q/%q/%q",
			namespace, digest, subjectKind, subjectID, producerKind, producerID,
			accepted, payloadState)
	}
	var supersessionCount int
	if err := service.db.QueryRow(
		`SELECT count(*) FROM evidence_supersessions WHERE evidence_id = ?`,
		fixture.evidenceID,
	).Scan(&supersessionCount); err != nil {
		t.Fatal(err)
	}
	if supersessionCount != len(fixture.supersedes) {
		t.Fatalf("supersession count = %d", supersessionCount)
	}
}

func TestEvidenceReservationRejectsSubmittedDigestMismatchWithoutMutation(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

	disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, fixture))
	if disposition.Code != "EVIDENCE_IDEMPOTENCY_CONFLICT" ||
		disposition.Retryable {
		t.Fatalf("disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_reservations", 0)
	assertEvidenceTableCount(t, service, "evidence_relationships", 0)
	assertEvidenceTableCount(t, service, "edges", 0)
	assertEvidenceTableCount(t, service, "records", 0)
}

func TestEvidenceReservationKeepsFirstProducerOnIdenticalRetry(t *testing.T) {
	service := newTestService(t)
	first := defaultEvidenceEdgeFixture(t)
	if disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, first)); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}
	retry := first
	retry.recordID = "rec_evidence_retry"
	retry.edgeID = "edge_evidence_retry"
	retry.segmentSeq = 2
	retry.recordedAt = "2026-07-29T11:05:00Z"
	retry.producer = evidenceProducer{Kind: "span", ID: "6666666666666666"}
	if disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, retry)); disposition.Outcome != "accepted" {
		t.Fatalf("retry disposition = %#v", disposition)
	}

	assertEvidenceTableCount(t, service, "evidence_reservations", 1)
	assertEvidenceTableCount(t, service, "evidence_relationships", 1)
	assertEvidenceTableCount(t, service, "edges", 1)
	assertEvidenceTableCount(t, service, "records", 1)
	var producerID string
	var recordedAt, edgeID string
	if err := service.db.QueryRow(
		`SELECT producer_id, recorded_at, edge_id
		 FROM evidence_relationships WHERE evidence_id = ?`,
		first.evidenceID,
	).Scan(&producerID, &recordedAt, &edgeID); err != nil {
		t.Fatal(err)
	}
	if producerID != first.producer.ID {
		t.Fatalf("producer = %q, want first %q", producerID, first.producer.ID)
	}
	if recordedAt != first.recordedAt || edgeID != first.edgeID {
		t.Fatalf("retry replaced first relationship metadata: %q/%q", recordedAt, edgeID)
	}
}

func TestEvidenceReservationRetryUsesWinningDigestAfterArtifactChanges(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.sourceMode = "inline"
	fixture.captureState = "available"
	preview := `{"score":0.9}`
	fixture.digest = evidenceFixtureDigestWithPreview(t, fixture, preview)
	insertEvidenceArtifact(t, service, fixture, preview)

	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}
	if _, err := service.db.Exec(
		`UPDATE artifacts SET preview_json = ? WHERE artifact_id = ?`,
		`{"score":0.1}`,
		fixture.source.ID,
	); err != nil {
		t.Fatal(err)
	}

	retry := fixture
	retry.recordID = "rec_evidence_artifact_changed_retry"
	retry.edgeID = "edge_evidence_artifact_changed_retry"
	retry.segmentSeq = 2
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, retry),
	); disposition.Outcome != "accepted" {
		t.Fatalf("retry disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_reservations", 1)
	assertEvidenceTableCount(t, service, "evidence_relationships", 1)
	assertEvidenceTableCount(t, service, "edges", 1)
}

func TestEvidenceReservationRejectsDifferentIdentityOrContent(t *testing.T) {
	for name, mutate := range map[string]func(*evidenceEdgeFixture){
		"idempotency key hash": func(fixture *evidenceEdgeFixture) {
			fixture.idempotencyKeyHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
		},
		"subject": func(fixture *evidenceEdgeFixture) {
			fixture.subject = NodeRef{Kind: "span", ID: "7777777777777777"}
		},
		"source": func(fixture *evidenceEdgeFixture) {
			fixture.source = NodeRef{Kind: "artifact", ID: "artifact_other_source"}
		},
	} {
		t.Run(name, func(t *testing.T) {
			service := newTestService(t)
			first := defaultEvidenceEdgeFixture(t)
			if disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, first)); disposition.Outcome != "accepted" {
				t.Fatalf("first disposition = %#v", disposition)
			}
			conflict := first
			conflict.recordID = "rec_evidence_conflict"
			conflict.edgeID = "edge_evidence_conflict"
			conflict.segmentSeq = 2
			mutate(&conflict)
			conflict.digest = evidenceFixtureDigest(t, conflict)

			disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, conflict))
			if disposition.Code != "EVIDENCE_IDEMPOTENCY_CONFLICT" ||
				disposition.Retryable {
				t.Fatalf("conflict disposition = %#v", disposition)
			}
			assertEvidenceTableCount(t, service, "evidence_reservations", 1)
			assertEvidenceTableCount(t, service, "edges", 1)
		})
	}
}

func TestEvidenceReservationRecomputesInlineStateWithoutArtifact(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.sourceMode = "inline"
	fixture.captureState = "not-captured"
	fixture.digest = evidenceFixtureDigest(t, fixture)
	if disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, fixture)); disposition.Outcome != "accepted" {
		t.Fatalf("disposition = %#v", disposition)
	}
	var payloadState string
	if err := service.db.QueryRow(
		`SELECT payload_state FROM evidence_relationships WHERE evidence_id = ?`,
		fixture.evidenceID,
	).Scan(&payloadState); err != nil {
		t.Fatal(err)
	}
	if payloadState != "not-captured" {
		t.Fatalf("payload state = %q", payloadState)
	}
}

func TestEvidenceReservationSurvivesRestart(t *testing.T) {
	t.Setenv("CRUX_OBSERVABILITY_RETENTION_DAYS", "36500")
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	first, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	fixture := defaultEvidenceEdgeFixture(t)
	if disposition := evidenceDisposition(t, first, evidenceEdgeTestRecord(t, fixture)); disposition.Outcome != "accepted" {
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
	conflict := fixture
	conflict.recordID = "rec_evidence_restart_conflict"
	conflict.edgeID = "edge_evidence_restart_conflict"
	conflict.segmentSeq = 2
	conflict.source = NodeRef{Kind: "artifact", ID: "artifact_restart_other"}
	conflict.digest = evidenceFixtureDigest(t, conflict)
	disposition := evidenceDisposition(t, reopened, evidenceEdgeTestRecord(t, conflict))
	if disposition.Code != "EVIDENCE_IDEMPOTENCY_CONFLICT" {
		t.Fatalf("restart disposition = %#v", disposition)
	}
}

func TestEvidenceReservationAcceptsNonIdempotentRelationship(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.nonIdempotent = true
	if disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, fixture)); disposition.Outcome != "accepted" {
		t.Fatalf("disposition = %#v", disposition)
	}
	var contentDigest sql.NullString
	if err := service.db.QueryRow(
		`SELECT content_digest FROM evidence_reservations WHERE evidence_id = ?`,
		fixture.evidenceID,
	).Scan(&contentDigest); err != nil {
		t.Fatal(err)
	}
	if contentDigest.Valid {
		t.Fatalf("non-idempotent relationship stored content digest %q", contentDigest.String)
	}
}

func assertEvidenceTableCount(
	t *testing.T,
	service *Service,
	table string,
	want int,
) {
	t.Helper()
	var count int
	if err := service.db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("%s count = %d, want %d", table, count, want)
	}
}
