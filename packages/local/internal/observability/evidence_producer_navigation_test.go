package observability

import (
	"fmt"
	"testing"
)

func TestEvidenceInspectorRetainsOutOfOrderProducerSpanNavigation(
	t *testing.T,
) {
	service := newTestService(t)
	fixture := evidenceRelationshipFixture(
		t, "6666666666666666", "verification", "passed", 1,
	)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("evidence = %#v", disposition)
	}
	assertProducer := func() {
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
		producer := result.Roles.Verification.Records[0].Producer
		if producer == nil || producer.ID != fixture.producer.ID {
			t.Fatalf("producer = %#v", producer)
		}
	}
	assertProducer()

	span := mustRecord(t, fmt.Sprintf(`{
		"schemaVersion":5,
		"recordId":"rec_late_evidence_producer",
		"type":"span",
		"operationId":%q,
		"runId":%q,
		"segmentId":%q,
		"segmentSeq":2,
		"spanId":%q,
		"family":"agent",
		"primitive":"agent.run",
		"name":"producer",
		"startedAt":"2026-07-29T12:00:00Z",
		"status":"running"
	}`, fixture.operationID, fixture.runID, fixture.segmentID,
		fixture.producer.ID))
	if disposition := evidenceDisposition(
		t,
		service,
		span,
	); disposition.Outcome != "accepted" {
		t.Fatalf("span = %#v", disposition)
	}
	var exists int
	if err := service.db.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM spans WHERE span_id = ?)`,
		fixture.producer.ID,
	).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists != 1 {
		t.Fatal("late producer span was not materialized")
	}
	assertProducer()
}
