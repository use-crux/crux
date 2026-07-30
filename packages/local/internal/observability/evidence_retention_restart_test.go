package observability

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func TestReducedEvidenceRetentionUsesPersistedAcceptanceClocksAfterRestart(
	t *testing.T,
) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	first := newEvidenceRetentionFileService(
		t,
		path,
		func() time.Time { return now },
		4*time.Hour,
		4*time.Hour,
	)
	fixture, artifact, edge := availableEvidencePair(
		t,
		`{"approved":true}`,
	)
	for _, record := range []Record{edge, artifact} {
		if disposition := evidenceDisposition(
			t,
			first,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("initial disposition = %#v", disposition)
		}
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	now = now.Add(2 * time.Hour)
	reopened := newEvidenceRetentionFileService(
		t,
		path,
		func() time.Time { return now },
		4*time.Hour,
		time.Hour,
	)
	result, err := reopened.InspectEvidence(
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
	record := result.Roles.Verification.Records[0]
	if record.PayloadState != "redacted" ||
		record.PayloadUnavailableReason != "retention" ||
		len(record.Data) != 0 {
		t.Fatalf("restarted payload = %#v", record)
	}
}

func TestIncreasingEvidenceRetentionNeverRestoresCompactedPayload(
	t *testing.T,
) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	first := newEvidenceRetentionFileService(
		t,
		path,
		func() time.Time { return now },
		4*time.Hour,
		time.Hour,
	)
	fixture, artifact, edge := availableEvidencePair(
		t,
		`{"marker":"`+evidenceRetentionSentinel+`"}`,
	)
	for _, record := range []Record{edge, artifact} {
		if disposition := evidenceDisposition(
			t,
			first,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("initial disposition = %#v", disposition)
		}
	}
	now = now.Add(2 * time.Hour)
	if _, err := first.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   fixture.subject.ID,
			},
			Role:  fixture.role,
			Limit: 50,
		},
	); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	reopened := newEvidenceRetentionFileService(
		t,
		path,
		func() time.Time { return now },
		4*time.Hour,
		4*time.Hour,
	)
	assertEvidencePayloadState(
		t,
		reopened,
		fixture.evidenceID,
		"redacted",
		"retention",
	)
	assertExpiredPayloadIsUnavailable(
		t,
		reopened,
		fixture,
		evidenceRetentionSentinel,
	)
}

func TestReducedRelationshipRetentionExpiresExistingIdentityAfterRestart(
	t *testing.T,
) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	first := newEvidenceRetentionFileService(
		t,
		path,
		func() time.Time { return now },
		4*time.Hour,
		4*time.Hour,
	)
	fixture := defaultEvidenceEdgeFixture(t)
	if disposition := evidenceDisposition(
		t,
		first,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("initial edge = %#v", disposition)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	now = now.Add(3 * time.Hour)
	reopened := newEvidenceRetentionFileService(
		t,
		path,
		func() time.Time { return now },
		2*time.Hour,
		2*time.Hour,
	)
	result, err := reopened.InspectEvidence(
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
	if role.Status != "not-yet-recorded" || !role.Truncated {
		t.Fatalf("reduced relationship retention = %#v", role)
	}
}

func TestReducedRelationshipRetentionExpiresCoverageAfterRestart(
	t *testing.T,
) {
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	first := newEvidenceRetentionFileService(
		t,
		path,
		func() time.Time { return now },
		4*time.Hour,
		4*time.Hour,
	)
	if disposition := evidenceDisposition(
		t,
		first,
		evidenceCoverageProjectionRecord(t, 1, "not-configured"),
	); disposition.Outcome != "accepted" {
		t.Fatalf("coverage = %#v", disposition)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	now = now.Add(3 * time.Hour)
	reopened := newEvidenceRetentionFileService(
		t,
		path,
		func() time.Time { return now },
		2*time.Hour,
		2*time.Hour,
	)
	result, err := reopened.InspectEvidence(
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
		role.Coverage != "" ||
		!role.Truncated {
		t.Fatalf("reduced coverage retention = %#v", role)
	}
}

func newEvidenceRetentionFileService(
	t *testing.T,
	path string,
	now func() time.Time,
	relationshipRetention time.Duration,
	payloadRetention time.Duration,
) *Service {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	service, err := newServiceWithOptions(
		context.Background(),
		db,
		fileDatabaseMaxOpenConns,
		serviceOptions{
			evidenceNow: now,
			evidenceSettings: &evidenceSettings{
				RelationshipRetention: relationshipRetention,
				PayloadRetention:      payloadRetention,
				StagingTTL:            time.Hour,
			},
		},
	)
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	return service
}
