package observability

import (
	"testing"
	"time"
)

func TestExpiredSuccessorDoesNotReactivateItsPredecessor(t *testing.T) {
	now := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	predecessor, successor := outOfOrderSupersessionFixtures(t)
	acceptEvidenceFixture(t, service, successor)

	now = now.Add(2 * time.Hour)
	predecessor.recordedAt = "2026-07-30T11:00:00Z"
	predecessor.observedAt = "2026-07-30T10:59:59Z"
	predecessor.digest = evidenceFixtureDigest(t, predecessor)
	acceptEvidenceFixture(t, service, predecessor)

	now = now.Add(time.Hour + time.Minute)
	runEvidenceRetentionForTest(t, service, now)
	assertSupersededPredecessorOnlyHistory(t, service, predecessor)
}

func TestDeletedSuccessorDoesNotReactivateOrRetainItsIdentity(t *testing.T) {
	service := newTestService(t)
	seedEvidenceSurvivingSubject(t, service)
	predecessor, successor := outOfOrderSupersessionFixtures(t)
	acceptEvidenceFixture(t, service, successor)
	acceptEvidenceFixture(t, service, predecessor)

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{successor.operationID},
	); err != nil {
		t.Fatal(err)
	}
	assertSupersededPredecessorOnlyHistory(t, service, predecessor)
	var retainedIdentityCount int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_supersessions
		WHERE evidence_id = ? OR superseded_evidence_id = ?
	`, successor.evidenceID, successor.evidenceID).Scan(
		&retainedIdentityCount,
	); err != nil {
		t.Fatal(err)
	}
	if retainedIdentityCount != 0 {
		t.Fatalf(
			"deleted successor supersession identities = %d, want 0",
			retainedIdentityCount,
		)
	}
}

func outOfOrderSupersessionFixtures(
	t *testing.T,
) (evidenceEdgeFixture, evidenceEdgeFixture) {
	t.Helper()
	predecessor := evidenceRelationshipFixture(
		t,
		"aaaaaaaaaaaaaaaa",
		"verification",
		"failed",
		1,
	)
	predecessor.runID = "run_supersession_predecessor"
	predecessor.operationID = predecessor.runID
	predecessor.segmentID = "seg_supersession_predecessor"
	predecessor.producer = evidenceProducer{Kind: "run", ID: predecessor.runID}
	predecessor.digest = evidenceFixtureDigest(t, predecessor)

	successor := evidenceRelationshipFixture(
		t,
		"bbbbbbbbbbbbbbbb",
		"verification",
		"passed",
		1,
	)
	successor.runID = "run_supersession_successor"
	successor.operationID = successor.runID
	successor.segmentID = "seg_supersession_successor"
	successor.producer = evidenceProducer{Kind: "run", ID: successor.runID}
	successor.supersedes = []string{predecessor.evidenceID}
	successor.digest = evidenceFixtureDigest(t, successor)
	return predecessor, successor
}

func acceptEvidenceFixture(
	t *testing.T,
	service *Service,
	fixture evidenceEdgeFixture,
) {
	t.Helper()
	disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	)
	if disposition.Outcome != "accepted" {
		t.Fatalf("%s disposition = %#v", fixture.evidenceID, disposition)
	}
}

func assertSupersededPredecessorOnlyHistory(
	t *testing.T,
	service *Service,
	predecessor evidenceEdgeFixture,
) {
	t.Helper()
	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   predecessor.subject.ID,
		},
		Role:           predecessor.role,
		IncludeHistory: true,
		Limit:          50,
	})
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if role.ActiveRecordCount != 0 ||
		len(role.Records) != 0 ||
		len(role.History) != 1 ||
		role.History[0].Ref.ID != predecessor.evidenceID ||
		role.Conclusion != "" ||
		!role.Truncated {
		t.Fatalf("superseded predecessor projection = %#v", role)
	}
}
