package observability

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestEvidenceArtifactFirstPromotesAtomicallyWithRelationship(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, edge := availableEvidencePair(t, `{"approved":true}`)

	dispositions := service.IngestWithDispositions(
		t.Context(),
		Batch{SchemaVersion: SchemaVersion, Records: []Record{artifact, edge}},
	)
	for _, disposition := range dispositions {
		if disposition.Outcome != "accepted" {
			t.Fatalf("dispositions = %#v", dispositions)
		}
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "verified")
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)
	assertEvidenceTableCount(t, service, "artifacts", 1)
	assertEvidenceTableCount(t, service, "records", 2)
}

func TestEvidenceEdgeFirstHydratesOnLaterArtifact(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, edge := availableEvidencePair(t, `{"approved":true}`)

	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	var state, verification string
	if err := service.db.QueryRow(`
		SELECT relationships.payload_state, reservations.digest_verification_state
		FROM evidence_relationships relationships
		JOIN evidence_reservations reservations
		  USING (authorization_namespace, evidence_id)
		WHERE relationships.evidence_id = ?
	`, fixture.evidenceID).Scan(&state, &verification); err != nil {
		t.Fatal(err)
	}
	if state != "reference" || verification != "pending" {
		t.Fatalf("pre-hydration state = %q/%q", state, verification)
	}

	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "verified")
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)
}

func TestEvidenceMismatchingArtifactDoesNotPoisonPendingWinner(t *testing.T) {
	service := newTestService(t)
	fixture, matching, edge := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	mismatch := mutateEvidenceArtifactPreview(
		t,
		matching,
		map[string]any{"approved": false},
	)
	mismatch = mutateEvidenceArtifactRecordID(t, mismatch, "rec_evidence_mismatch")
	if disposition := evidenceDisposition(t, service, mismatch); disposition.Code != evidenceIdempotencyConflictCode {
		t.Fatalf("mismatch disposition = %#v", disposition)
	}
	assertPendingEvidence(t, service, fixture.evidenceID)

	if disposition := evidenceDisposition(t, service, matching); disposition.Outcome != "accepted" {
		t.Fatalf("matching disposition = %#v", disposition)
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "verified")
}

func TestEvidencePromotionDeletesEveryLosingSibling(t *testing.T) {
	service := newTestService(t)
	fixture, matching, edge := availableEvidencePair(t, `{"approved":true}`)
	first := mutateEvidenceArtifactPreview(
		t,
		matching,
		map[string]any{"approved": false},
	)
	first = mutateEvidenceArtifactRecordID(t, first, "rec_evidence_loser_one")
	second := mutateEvidenceArtifactPreview(
		t,
		matching,
		map[string]any{"approved": false, "revision": 2},
	)
	second = mutateEvidenceArtifactRecordID(t, second, "rec_evidence_loser_two")
	for _, artifact := range []Record{first, second, matching} {
		if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
			t.Fatalf("artifact disposition = %#v", disposition)
		}
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 3)

	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "verified")
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)
	assertEvidenceTableCount(t, service, "artifacts", 1)
	assertEvidenceTableCount(t, service, "records", 2)
}

func TestEvidenceCandidateTombstoneDoesNotRejectIndependentEdge(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, _ := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	if _, err := service.db.Exec(`
		INSERT INTO operation_tombstones (operation_id, deleted_at)
		VALUES ('run_evidence_reservation', '2026-07-29T12:00:00Z')
	`); err != nil {
		t.Fatal(err)
	}
	fixture.runID = "run_independent_edge"
	fixture.operationID = "run_independent_edge"
	fixture.segmentID = "seg_independent_edge"
	fixture.segmentSeq = 1

	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	assertPendingEvidence(t, service, fixture.evidenceID)
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)
	assertEvidenceTableCount(t, service, "artifacts", 0)
	assertEvidenceHealthCount(
		t,
		service,
		evidenceStagingUnpromotableCode,
		1,
	)
}

func TestEvidenceCandidateCleanupSurvivesEdgeRejection(t *testing.T) {
	service := newTestService(t)
	_, artifact, edge := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	if _, err := service.db.Exec(`
		INSERT INTO operation_tombstones (operation_id, deleted_at)
		VALUES ('run_evidence_reservation', '2026-07-29T12:00:00Z')
	`); err != nil {
		t.Fatal(err)
	}

	disposition := evidenceDisposition(t, service, edge)
	if disposition.Code != "operation_deleted" || disposition.Retryable {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)
	assertEvidenceTableCount(t, service, "evidence_reservations", 0)
	assertEvidenceHealthCount(
		t,
		service,
		evidenceStagingUnpromotableCode,
		1,
	)
}

func availableEvidencePair(
	t *testing.T,
	preview string,
) (evidenceEdgeFixture, Record, Record) {
	t.Helper()
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.sourceMode = "inline"
	fixture.captureState = "available"
	fixture.segmentSeq = 2
	fixture.digest = evidenceFixtureDigestWithPreview(t, fixture, preview)
	artifact := evidenceInlineArtifactRecord(t, fixture, preview)
	return fixture, artifact, evidenceEdgeTestRecord(t, fixture)
}

func evidenceInlineArtifactRecord(
	t *testing.T,
	fixture evidenceEdgeFixture,
	preview string,
) Record {
	t.Helper()
	return mustRecord(t, fmt.Sprintf(`{
		"schemaVersion":5,
		"recordId":"rec_evidence_inline_artifact",
		"type":"artifact",
		"operationId":"run_evidence_reservation",
		"runId":"run_evidence_reservation",
		"segmentId":"seg_evidence_reservation",
		"segmentSeq":1,
		"artifactId":"%s",
		"kind":"%s",
		"createdAt":"%s",
		"contentType":"application/json",
		"encoding":"json",
		"preview":%s,
		"attributes":{"evidenceSource":{
			"evidenceId":"%s",
			"captureState":"available"
		}}
	}`, fixture.source.ID, fixture.evidenceKind, fixture.recordedAt, preview,
		fixture.evidenceID))
}

func assertHydratedEvidence(
	t *testing.T,
	service *Service,
	evidenceID string,
	wantVerification string,
) {
	t.Helper()
	var state, payload, verification string
	if err := service.db.QueryRow(`
		SELECT relationships.payload_state, relationships.payload_json,
			reservations.digest_verification_state
		FROM evidence_relationships relationships
		JOIN evidence_reservations reservations
		  USING (authorization_namespace, evidence_id)
		WHERE relationships.evidence_id = ?
	`, evidenceID).Scan(&state, &payload, &verification); err != nil {
		t.Fatal(err)
	}
	var decoded map[string]bool
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatal(err)
	}
	if state != "available" || !decoded["approved"] ||
		verification != wantVerification {
		t.Fatalf("hydrated evidence = %q/%s/%q", state, payload, verification)
	}
}

func assertPendingEvidence(t *testing.T, service *Service, evidenceID string) {
	t.Helper()
	var state, verification string
	if err := service.db.QueryRow(`
		SELECT relationships.payload_state, reservations.digest_verification_state
		FROM evidence_relationships relationships
		JOIN evidence_reservations reservations
		  USING (authorization_namespace, evidence_id)
		WHERE relationships.evidence_id = ?
	`, evidenceID).Scan(&state, &verification); err != nil {
		t.Fatal(err)
	}
	if state != "reference" || verification != "pending" {
		t.Fatalf("pending evidence = %q/%q", state, verification)
	}
}

func assertEvidenceHealthCount(
	t *testing.T,
	service *Service,
	code string,
	want int,
) {
	t.Helper()
	var count int
	if err := service.db.QueryRow(`
		SELECT occurrence_count FROM evidence_ingest_health
		WHERE authorization_namespace = ? AND code = ?
	`, localEvidenceAuthorizationNamespace, code).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("%s health count = %d, want %d", code, count, want)
	}
}
