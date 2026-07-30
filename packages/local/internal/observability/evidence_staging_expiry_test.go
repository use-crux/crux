package observability

import (
	"testing"
	"time"
)

func TestEvidenceCandidateExpiryUsesAggregateDeduplicatedHealth(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	service := newEvidenceStagingTestService(t, func() time.Time { return now })
	first := evidenceSourceArtifactTestRecord(t)
	if disposition := evidenceDisposition(t, service, first); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}

	now = now.Add(service.evidenceSettings.StagingTTL + time.Second)
	second := mutateEvidenceArtifactIdentity(
		t,
		evidenceSourceArtifactTestRecord(t),
		"evidence_2222222222222222",
		"artifact_evidence_second",
		"rec_evidence_artifact_second",
	)
	if disposition := evidenceDisposition(t, service, second); disposition.Outcome != "accepted" {
		t.Fatalf("second disposition = %#v", disposition)
	}
	assertEvidenceHealthCount(
		t,
		service,
		"EVIDENCE_STAGING_EXPIRED",
		1,
	)

	third := mutateEvidenceArtifactIdentity(
		t,
		evidenceSourceArtifactTestRecord(t),
		"evidence_3333333333333333",
		"artifact_evidence_third",
		"rec_evidence_artifact_third",
	)
	if disposition := evidenceDisposition(t, service, third); disposition.Outcome != "accepted" {
		t.Fatalf("third disposition = %#v", disposition)
	}
	assertEvidenceHealthCount(
		t,
		service,
		"EVIDENCE_STAGING_EXPIRED",
		1,
	)

	var code string
	if err := service.db.QueryRow(`
		SELECT code FROM evidence_ingest_health
		WHERE code = 'EVIDENCE_STAGING_EXPIRED'
	`).Scan(&code); err != nil {
		t.Fatal(err)
	}
	if code != "EVIDENCE_STAGING_EXPIRED" {
		t.Fatalf("expiry health code = %q", code)
	}
}

func TestEvidenceCandidateExpiresThroughPeriodicRetentionWithoutRuns(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	service := newEvidenceStagingTestService(t, func() time.Time { return now })
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceSourceArtifactTestRecord(t),
	); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	now = now.Add(service.evidenceSettings.StagingTTL + time.Second)

	if _, err := service.runRetention(
		t.Context(),
		service.retentionSettings,
		now,
	); err != nil {
		t.Fatal(err)
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)
	assertEvidenceHealthCount(
		t,
		service,
		"EVIDENCE_STAGING_EXPIRED",
		1,
	)
}

func TestEvidenceExpiredCandidateLeavesRelationshipHydratable(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	service := newEvidenceStagingTestService(t, func() time.Time { return now })
	fixture, artifact, edge := availableEvidencePair(t, `{"approved":true}`)
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	now = now.Add(service.evidenceSettings.StagingTTL + time.Second)

	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	assertPendingEvidence(t, service, fixture.evidenceID)
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)

	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("late artifact disposition = %#v", disposition)
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "verified")
}

func TestEvidenceCandidateExpiryComparesSubsecondTimeChronologically(t *testing.T) {
	now := time.Date(2026, 7, 29, 12, 0, 0, 0, time.UTC)
	service := newEvidenceStagingTestService(t, func() time.Time { return now })
	service.evidenceSettings.StagingTTL = time.Second
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceSourceArtifactTestRecord(t),
	); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	now = now.Add(1500 * time.Millisecond)
	if err := service.cleanupExpiredEvidenceCandidates(
		t.Context(),
		now,
	); err != nil {
		t.Fatal(err)
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 0)
}
