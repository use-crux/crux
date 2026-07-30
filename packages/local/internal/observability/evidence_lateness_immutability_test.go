package observability

import (
	"fmt"
	"testing"
)

func TestEvidenceAcceptedAfterTerminalIsImmutableAcrossRetry(t *testing.T) {
	service := newTestService(t)
	fixture := evidenceRelationshipFixture(
		t, "eeeeeeeeeeeeeee2", "verification", "passed", 1,
	)
	edge := evidenceEdgeTestRecord(t, fixture)
	for _, record := range []Record{
		edge,
		evidenceSpanTerminalRecord(t, fixture.subject.ID, 2, "ok"),
		edge,
	} {
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("disposition = %#v", disposition)
		}
	}
	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   fixture.subject.ID,
			},
			Role:  "verification",
			Limit: 50,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Roles.Verification.Records[0].AcceptedAfterTerminal != nil {
		t.Fatal("retry backfilled accepted-after-terminal")
	}
}

func TestEvidenceAcceptedAfterTerminalIgnoresReconciledRunState(
	t *testing.T,
) {
	service := newTestService(t)
	runID := "run_late_subject"
	if _, err := service.db.Exec(`
		INSERT INTO runs (run_id, operation_id, status, lifecycle_status)
		VALUES (?, ?, 'error', 'conflicted')
	`, runID, runID); err != nil {
		t.Fatal(err)
	}
	fixture := evidenceRelationshipFixture(
		t, "eeeeeeeeeeeeeee3", "verification", "passed", 1,
	)
	fixture.subject = NodeRef{Kind: "run", ID: runID}
	fixture.digest = evidenceFixtureDigest(t, fixture)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("evidence = %#v", disposition)
	}
	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{Kind: "execution", ID: runID},
			Role:    "verification",
			Limit:   50,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Roles.Verification.Records[0].AcceptedAfterTerminal != nil {
		t.Fatal("reconciled status fabricated accepted-after-terminal")
	}
}

func TestEvidenceAcceptedAfterTerminalOmitsArtifactSubjects(t *testing.T) {
	service := newTestService(t)
	fixture := evidenceRelationshipFixture(
		t, "eeeeeeeeeeeeeee4", "verification", "passed", 1,
	)
	fixture.subject = NodeRef{
		Kind: "artifact",
		ID:   "artifact_1111111111111111",
	}
	fixture.digest = evidenceFixtureDigest(t, fixture)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("evidence = %#v", disposition)
	}
	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "artifact",
				ID:   fixture.subject.ID,
			},
			Role:  "verification",
			Limit: 50,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Roles.Verification.Records[0].AcceptedAfterTerminal != nil {
		t.Fatal("artifact subject received accepted-after-terminal")
	}
}

func evidenceSpanTerminalRecord(
	t *testing.T,
	spanID string,
	sequence int,
	status string,
) Record {
	t.Helper()
	return mustRecord(t, fmt.Sprintf(`{
		"schemaVersion":5,
		"recordId":"rec_evidence_terminal_%d",
		"type":"span:end",
		"operationId":"run_evidence_reservation",
		"runId":"run_evidence_reservation",
		"segmentId":"seg_evidence_reservation",
		"segmentSeq":%d,
		"spanId":%q,
		"endedAt":"2099-01-01T00:00:00Z",
		"status":%q
	}`, sequence, sequence, spanID, status))
}

func evidenceRunTerminalRecord(t *testing.T, status string) Record {
	t.Helper()
	return mustRecord(t, fmt.Sprintf(`{
		"schemaVersion":5,
		"recordId":"rec_run_terminal",
		"type":"run:end",
		"operationId":"run_late_subject",
		"runId":"run_late_subject",
		"segmentId":"seg_run_late_subject",
		"segmentSeq":1,
		"endedAt":"2099-01-01T00:00:00Z",
		"status":%q
	}`, status))
}

func evidenceRunSuspensionRecord(t *testing.T) Record {
	t.Helper()
	return mustRecord(t, `{
		"schemaVersion":5,
		"recordId":"rec_run_suspended",
		"type":"run:suspend",
		"operationId":"run_late_subject",
		"runId":"run_late_subject",
		"segmentId":"seg_run_late_subject",
		"segmentSeq":1,
		"suspendedAt":"2099-01-01T00:00:00Z",
		"reason":"approval"
	}`)
}
