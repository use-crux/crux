package observability

import (
	"testing"
	"time"
)

func TestEvidenceRetentionClocksPreserveNanosecondBoundaries(t *testing.T) {
	t.Run("relationship", func(t *testing.T) {
		now := time.Date(
			2026,
			7,
			29,
			11,
			0,
			0,
			123456789,
			time.UTC,
		)
		service := newEvidenceRetentionTestService(
			t,
			func() time.Time { return now },
		)
		service.evidenceSettings.RelationshipRetention = time.Microsecond
		fixture := defaultEvidenceEdgeFixture(t)
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("edge = %#v", disposition)
		}
		now = now.Add(time.Microsecond - time.Nanosecond)
		if err := service.cleanupExpiredEvidenceRelationships(
			t.Context(),
			now,
		); err != nil {
			t.Fatal(err)
		}
		assertEvidenceQueryCount(
			t,
			service,
			"relationship before nanosecond boundary",
			`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
			fixture.evidenceID,
			1,
		)
		now = now.Add(time.Nanosecond)
		if err := service.cleanupExpiredEvidenceRelationships(
			t.Context(),
			now,
		); err != nil {
			t.Fatal(err)
		}
		assertEvidenceQueryCount(
			t,
			service,
			"relationship at nanosecond boundary",
			`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
			fixture.evidenceID,
			0,
		)
	})

	t.Run("payload", func(t *testing.T) {
		now := time.Date(
			2026,
			7,
			29,
			11,
			0,
			0,
			987654321,
			time.UTC,
		)
		service := newEvidenceRetentionTestService(
			t,
			func() time.Time { return now },
		)
		service.evidenceSettings.PayloadRetention = time.Microsecond
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
				t.Fatalf("record = %#v", disposition)
			}
		}
		now = now.Add(time.Microsecond - time.Nanosecond)
		if err := service.cleanupExpiredEvidencePayloads(
			t.Context(),
			now,
		); err != nil {
			t.Fatal(err)
		}
		assertEvidencePayloadState(
			t,
			service,
			fixture.evidenceID,
			"available",
			"",
		)
		now = now.Add(time.Nanosecond)
		if err := service.cleanupExpiredEvidencePayloads(
			t.Context(),
			now,
		); err != nil {
			t.Fatal(err)
		}
		assertEvidencePayloadState(
			t,
			service,
			fixture.evidenceID,
			"redacted",
			"retention",
		)
	})
}
