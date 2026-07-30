package observability

import (
	"fmt"
	"testing"
	"time"
)

func TestEvidenceRelationshipRetentionUsesOnlyLocalAcceptanceTime(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.recordedAt = "1900-01-01T00:00:00Z"
	fixture.observedAt = "2999-12-31T23:59:59Z"
	fixture.digest = evidenceFixtureDigest(t, fixture)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("edge = %#v", disposition)
	}

	now = now.Add(3*time.Hour - time.Minute)
	runEvidenceRetentionForTest(t, service, now)
	assertEvidenceQueryCount(
		t,
		service,
		"relationship before local expiry",
		`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
		fixture.evidenceID,
		1,
	)
	now = now.Add(2 * time.Minute)
	runEvidenceRetentionForTest(t, service, now)
	assertEvidenceQueryCount(
		t,
		service,
		"relationship after local expiry",
		`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
		fixture.evidenceID,
		0,
	)
}

func TestEvidenceOutlivesRoutineRunRetention(t *testing.T) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	service.evidenceSettings.PayloadRetention = 3 * time.Hour
	service.retentionSettings.MaxRunAge = time.Hour
	fixture, artifact, edge := availableEvidencePair(
		t,
		`{"approved":true}`,
	)
	for _, record := range []Record{edge, artifact} {
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("initial disposition = %#v", disposition)
		}
	}

	now = now.Add(2 * time.Hour)
	runEvidenceRetentionForTest(t, service, now)
	assertEvidenceQueryCount(
		t,
		service,
		"routine-retained run",
		`SELECT count(*) FROM runs WHERE run_id = ?`,
		fixture.runID,
		0,
	)
	assertEvidenceQueryCount(
		t,
		service,
		"independently retained evidence",
		`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
		fixture.evidenceID,
		1,
	)
	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   fixture.subject.ID,
			},
			Role:        fixture.role,
			Limit:       50,
			IncludeData: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if role.Status != "present" ||
		len(role.Records) != 1 ||
		string(role.Records[0].Data) != `{"approved":true}` {
		t.Fatalf("retained evidence = %#v", role)
	}
}

func TestEvidenceInspectionAppliesLogicalExpiryBeforePeriodicCleanup(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	fixture := defaultEvidenceEdgeFixture(t)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("edge = %#v", disposition)
	}
	now = now.Add(3*time.Hour + time.Minute)

	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   fixture.subject.ID,
			},
			Role:  fixture.role,
			Limit: 50,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if role.Status != "not-yet-recorded" ||
		len(role.Records) != 0 ||
		!role.Truncated {
		t.Fatalf("logically expired evidence = %#v", role)
	}
}

func TestEvidenceInspectionHidesExpiredRowsBeyondCleanupBatch(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	for index := range retentionDeleteBatchSize + 1 {
		fixture := evidenceRelationshipFixture(
			t,
			fmt.Sprintf("%016x", index+1),
			"verification",
			"passed",
			index+1,
		)
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("edge %d = %#v", index, disposition)
		}
	}
	now = now.Add(3*time.Hour + time.Minute)
	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   "2222222222222222",
			},
			Role:  "verification",
			Limit: 50,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if role.Status != "not-yet-recorded" ||
		len(role.Records) != 0 ||
		!role.Truncated {
		t.Fatalf("bounded logical expiry = %#v", role)
	}
	var unprocessed int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_relationships
	`).Scan(&unprocessed); err != nil {
		t.Fatal(err)
	}
	if unprocessed != 1 {
		t.Fatalf("unprocessed physical rows = %d, want 1", unprocessed)
	}
}

func TestEvidencePredecessorIdentityReuseStartsWithoutStaleSupersession(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	predecessor := evidenceRelationshipFixture(
		t,
		"aaaaaaaaaaaaaaaa",
		"verification",
		"failed",
		1,
	)
	predecessorRecord := evidenceEdgeTestRecord(t, predecessor)
	if disposition := evidenceDisposition(
		t,
		service,
		predecessorRecord,
	); disposition.Outcome != "accepted" {
		t.Fatalf("predecessor = %#v", disposition)
	}
	now = now.Add(2 * time.Hour)
	successor := evidenceRelationshipFixture(
		t,
		"bbbbbbbbbbbbbbbb",
		"verification",
		"passed",
		2,
	)
	successor.supersedes = []string{predecessor.evidenceID}
	successor.digest = evidenceFixtureDigest(t, successor)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, successor),
	); disposition.Outcome != "accepted" {
		t.Fatalf("successor = %#v", disposition)
	}
	now = now.Add(90 * time.Minute)
	runEvidenceRetentionForTest(t, service, now)
	if disposition := evidenceDisposition(
		t,
		service,
		predecessorRecord,
	); disposition.Outcome != "accepted" {
		t.Fatalf("reused predecessor = %#v", disposition)
	}

	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   predecessor.subject.ID,
			},
			Role:           "verification",
			Limit:          50,
			IncludeHistory: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if len(role.Records) != 2 ||
		len(role.History) != 0 ||
		!role.Conflicting ||
		role.Conclusion != "" ||
		!role.Truncated {
		t.Fatalf("reused predecessor projection = %#v", role)
	}
}
