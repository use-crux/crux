package observability

import "testing"

func TestEvidenceDirectHydrationBypassesFullStagingCapacity(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, edge := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	seedEvidenceStagingRows(
		t,
		service,
		localEvidenceAuthorizationNamespace,
		evidenceCandidatesPerNamespace,
		0,
	)

	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "verified")
	assertEvidenceTableCount(
		t,
		service,
		"evidence_staging_candidates",
		evidenceCandidatesPerNamespace,
	)
}

func TestEvidenceCandidateCannotPoisonGenericSegmentSequence(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, edge := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	ordinary := mustRecord(t, `{
		"schemaVersion":5,
		"recordId":"rec_ordinary_artifact",
		"type":"artifact",
		"operationId":"run_evidence_reservation",
		"runId":"run_evidence_reservation",
		"segmentId":"seg_evidence_reservation",
		"segmentSeq":1,
		"artifactId":"artifact_ordinary",
		"kind":"output",
		"createdAt":"2026-07-29T10:00:00Z",
		"contentType":"application/json",
		"encoding":"json",
		"preview":{"ordinary":true}
	}`)
	if disposition := evidenceDisposition(t, service, ordinary); disposition.Outcome != "accepted" {
		t.Fatalf("ordinary disposition = %#v", disposition)
	}

	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	assertPendingEvidence(t, service, fixture.evidenceID)
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)
	assertEvidenceTableCount(t, service, "artifacts", 1)
	assertEvidenceHealthCount(
		t,
		service,
		evidenceStagingUnpromotableCode,
		1,
	)

	retry := mutateEvidenceArtifactRecordID(
		t,
		artifact,
		"rec_evidence_artifact_retry",
	)
	retry = mutateRecordSegmentSequence(t, retry, 3)
	if disposition := evidenceDisposition(t, service, retry); disposition.Outcome != "accepted" {
		t.Fatalf("later artifact disposition = %#v", disposition)
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "verified")
	assertEvidenceTableCount(t, service, "artifacts", 2)
}

func TestEvidenceTransientPromotionFailureKeepsCandidateForRetry(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, edge := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	if _, err := service.db.Exec(`
		CREATE TRIGGER fail_evidence_candidate_materialization
		BEFORE INSERT ON artifacts
		BEGIN
			SELECT RAISE(ABORT, 'temporary artifact storage failure');
		END
	`); err != nil {
		t.Fatal(err)
	}

	disposition := evidenceDisposition(t, service, edge)
	if disposition.Outcome != "rejected" || !disposition.Retryable {
		t.Fatalf("transient disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 1)
	assertEvidenceTableCount(t, service, "evidence_reservations", 0)

	if _, err := service.db.Exec(
		`DROP TRIGGER fail_evidence_candidate_materialization`,
	); err != nil {
		t.Fatal(err)
	}
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("retry disposition = %#v", disposition)
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "verified")
}

func TestEvidencePromotionRejectsTamperedStagedEnvelope(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, edge := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	if _, err := service.db.Exec(`
		UPDATE evidence_staging_candidates SET segment_seq = 999
		WHERE evidence_id = ?
	`, fixture.evidenceID); err != nil {
		t.Fatal(err)
	}

	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
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

func TestOrdinaryArtifactCannotVerifyEvidenceRelationship(t *testing.T) {
	service := newTestService(t)
	fixture, _, edge := availableEvidencePair(t, `{"approved":true}`)
	ordinary := mustRecord(t, `{
		"schemaVersion":5,
		"recordId":"rec_unmarked_evidence_source",
		"type":"artifact",
		"operationId":"run_evidence_reservation",
		"runId":"run_evidence_reservation",
		"segmentId":"seg_evidence_reservation",
		"segmentSeq":1,
		"artifactId":"artifact_evidence_source",
		"kind":"score.report",
		"createdAt":"2026-07-29T11:00:00Z",
		"contentType":"application/json",
		"encoding":"json",
		"preview":{"approved":true}
	}`)
	if disposition := evidenceDisposition(t, service, ordinary); disposition.Outcome != "accepted" {
		t.Fatalf("ordinary disposition = %#v", disposition)
	}
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	assertPendingEvidence(t, service, fixture.evidenceID)
}

func TestEvidencePromotionArtifactConflictWritesNoOrphanRecord(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, _ := availableEvidencePair(t, `{"approved":true}`)
	fixture.nonIdempotent = true
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("stage disposition = %#v", disposition)
	}
	collision := mustRecord(t, `{
		"schemaVersion":5,
		"recordId":"rec_evidence_artifact_collision",
		"type":"artifact",
		"operationId":"run_evidence_reservation",
		"runId":"run_evidence_reservation",
		"segmentId":"seg_evidence_reservation",
		"segmentSeq":5,
		"artifactId":"artifact_evidence_source",
		"kind":"output",
		"createdAt":"2026-07-29T11:00:00Z",
		"contentType":"application/json",
		"encoding":"json",
		"preview":{"ordinary":true}
	}`)
	dispositions := service.IngestWithDispositions(
		t.Context(),
		Batch{
			SchemaVersion: SchemaVersion,
			Records: []Record{
				collision,
				evidenceEdgeTestRecord(t, fixture),
			},
		},
	)
	for _, disposition := range dispositions {
		if disposition.Outcome != "accepted" {
			t.Fatalf("dispositions = %#v", dispositions)
		}
	}
	var orphanCount int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM records
		WHERE record_id = 'rec_evidence_inline_artifact'
	`).Scan(&orphanCount); err != nil {
		t.Fatal(err)
	}
	if orphanCount != 0 {
		t.Fatal("staged record committed without its evidence artifact")
	}
	assertEvidenceState(
		t,
		service,
		fixture.evidenceID,
		"reference",
		"not-required",
	)
}
