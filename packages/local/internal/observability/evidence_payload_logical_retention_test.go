package observability

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestEvidenceInspectionRedactsExpiredPayloadsBeyondCleanupBatch(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	preview := `{"marker":"LOGICAL-PAYLOAD-EXPIRY"}`
	for index := range retentionDeleteBatchSize + 1 {
		fixture := evidenceRelationshipFixture(
			t,
			fmt.Sprintf("%016x", index+1),
			"verification",
			"passed",
			2*index+2,
		)
		fixture.sourceMode = "inline"
		fixture.captureState = "available"
		fixture.digest = evidenceFixtureDigestWithPreview(
			t,
			fixture,
			preview,
		)
		artifact := evidenceInlineArtifactRecord(t, fixture, preview)
		artifact = mutateEvidenceArtifactRecordID(
			t,
			artifact,
			fmt.Sprintf("rec_logical_payload_%d", index+1),
		)
		artifact = mutateRecordSegmentSequence(t, artifact, 2*index+1)
		for _, record := range []Record{
			evidenceEdgeTestRecord(t, fixture),
			artifact,
		} {
			if disposition := evidenceDisposition(
				t,
				service,
				record,
			); disposition.Outcome != "accepted" {
				t.Fatalf("record %d = %#v", index, disposition)
			}
		}
	}

	now = now.Add(time.Hour + time.Minute)
	graph, err := service.Graph(t.Context(), "run_evidence_reservation")
	if err != nil {
		t.Fatal(err)
	}
	for _, artifact := range graph.Artifacts {
		if len(artifact.Preview) != 0 {
			t.Fatalf("generic artifact leaked preview: %#v", artifact)
		}
	}
	for _, record := range graph.Records {
		if strings.Contains(
			string(record.PayloadJSON),
			"LOGICAL-PAYLOAD-EXPIRY",
		) {
			t.Fatalf("generic raw record leaked payload: %#v", record)
		}
	}
	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   "2222222222222222",
			},
			Role:        "verification",
			Limit:       50,
			IncludeData: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if role.Status != "redacted" || len(role.Records) != 50 {
		t.Fatalf("logical payload summary = %#v", role)
	}
	for _, record := range role.Records {
		if record.PayloadState != "redacted" ||
			record.PayloadUnavailableReason != "retention" ||
			len(record.Data) != 0 {
			t.Fatalf("logical payload record = %#v", record)
		}
	}
	var unprocessed int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_relationships
		WHERE payload_state = 'available'
	`).Scan(&unprocessed); err != nil {
		t.Fatal(err)
	}
	if unprocessed != 1 {
		t.Fatalf("unprocessed physical payloads = %d, want 1", unprocessed)
	}
}
