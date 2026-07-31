package observability

import (
	"testing"
)

func TestEvidencePrivacyDeletionWatermarksSurvivingRelationshipSubject(
	t *testing.T,
) {
	service := newTestService(t)
	seedEvidenceSurvivingSubject(t, service)
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.subject = NodeRef{Kind: "span", ID: "2222222222222222"}
	fixture.digest = evidenceFixtureDigest(t, fixture)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("evidence = %#v", disposition)
	}
	before, err := evidenceSubjectRevision(
		t.Context(),
		service.db,
		fixture.subject.Kind,
		fixture.subject.ID,
	)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := service.DeleteRuns(t.Context(), []string{fixture.operationID}); err != nil {
		t.Fatal(err)
	}
	assertEvidenceQueryCount(
		t,
		service,
		"relationship",
		`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
		fixture.evidenceID,
		0,
	)
	var watermarks int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_truncation_watermarks
		WHERE subject_kind = ? AND subject_id = ? AND role = ?
	`, fixture.subject.Kind, fixture.subject.ID, fixture.role).Scan(
		&watermarks,
	); err != nil {
		t.Fatal(err)
	}
	if watermarks != 1 {
		t.Fatalf("watermarks = %d, want 1", watermarks)
	}
	after, err := evidenceSubjectRevision(
		t.Context(),
		service.db,
		fixture.subject.Kind,
		fixture.subject.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if after != before+1 {
		t.Fatalf("subject revision = %d, want %d", after, before+1)
	}
}

func TestEvidencePrivacyDeletionRemovesDeletedSubjectState(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.subject = NodeRef{Kind: "run", ID: fixture.runID}
	fixture.producer = evidenceProducer{Kind: "run", ID: fixture.runID}
	fixture.digest = evidenceFixtureDigest(t, fixture)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("evidence = %#v", disposition)
	}

	if _, err := service.DeleteRuns(t.Context(), []string{fixture.operationID}); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{
		"evidence_subject_revisions",
		"evidence_truncation_watermarks",
	} {
		var count int
		if err := service.db.QueryRow(
			"SELECT count(*) FROM "+table+
				" WHERE subject_kind = ? AND subject_id = ?",
			"run",
			fixture.runID,
		).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s rows = %d, want 0", table, count)
		}
	}
	if _, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   fixture.runID,
			},
			Limit: 50,
		},
	); err != ErrEvidenceNotFound {
		t.Fatalf("inspect deleted subject error = %v, want not found", err)
	}
}

func seedEvidenceSurvivingSubject(t *testing.T, service *Service) {
	t.Helper()
	if err := service.Ingest(t.Context(), mustBatch(t,
		`{
			"schemaVersion":5,
			"recordId":"rec_subject_run",
			"type":"run:start",
			"operationId":"run_subject",
			"runId":"run_subject",
			"segmentId":"seg_subject",
			"segmentSeq":1,
			"name":"subject",
			"rootPrimitive":"agent.run",
			"startedAt":"2026-07-29T10:00:00Z",
			"status":"running"
		}`,
		`{
			"schemaVersion":5,
			"recordId":"rec_subject_span",
			"type":"span:start",
			"operationId":"run_subject",
			"runId":"run_subject",
			"segmentId":"seg_subject",
			"segmentSeq":2,
			"spanId":"2222222222222222",
			"family":"agent",
			"primitive":"agent.run",
			"name":"subject span",
			"startedAt":"2026-07-29T10:00:01Z",
			"status":"running"
		}`,
	)); err != nil {
		t.Fatal(err)
	}
}
