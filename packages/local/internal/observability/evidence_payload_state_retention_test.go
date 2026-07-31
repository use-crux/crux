package observability

import (
	"testing"
	"time"
)

func TestEvidencePayloadRetentionPreservesNonAvailableStates(t *testing.T) {
	for _, test := range []struct {
		name       string
		sourceMode string
		state      string
		artifact   bool
		wantReason string
	}{
		{
			name:       "reference authored",
			sourceMode: "reference",
			state:      "reference",
		},
		{
			name:       "inline reference capture",
			sourceMode: "inline",
			state:      "reference",
			artifact:   true,
		},
		{
			name:       "inline not captured",
			sourceMode: "inline",
			state:      "not-captured",
			artifact:   true,
		},
		{
			name:       "policy redacted",
			sourceMode: "inline",
			state:      "redacted",
			wantReason: "policy",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
			service := newEvidenceRetentionTestService(
				t,
				func() time.Time { return now },
			)
			fixture := defaultEvidenceEdgeFixture(t)
			fixture.sourceMode = test.sourceMode
			fixture.captureState = test.state
			fixture.segmentSeq = 2
			fixture.digest = evidenceFixtureDigest(t, fixture)
			if test.artifact {
				artifact := referenceEvidenceArtifactRecord(
					t,
					fixture,
					"",
					test.state,
				)
				if disposition := evidenceDisposition(
					t,
					service,
					artifact,
				); disposition.Outcome != "accepted" {
					t.Fatalf("artifact = %#v", disposition)
				}
			}
			if disposition := evidenceDisposition(
				t,
				service,
				evidenceEdgeTestRecord(t, fixture),
			); disposition.Outcome != "accepted" {
				t.Fatalf("edge = %#v", disposition)
			}

			now = now.Add(time.Hour + time.Minute)
			runEvidenceRetentionForTest(t, service, now)
			assertEvidencePayloadState(
				t,
				service,
				fixture.evidenceID,
				test.state,
				test.wantReason,
			)
			var expiredAt any
			if err := service.db.QueryRow(`
				SELECT payload_expired_at FROM evidence_relationships
				WHERE evidence_id = ?
			`, fixture.evidenceID).Scan(&expiredAt); err != nil {
				t.Fatal(err)
			}
			if expiredAt != nil {
				t.Fatalf("payload expiry clock = %#v", expiredAt)
			}
		})
	}
}
