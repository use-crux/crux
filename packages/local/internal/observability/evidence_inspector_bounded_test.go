package observability

import (
	"fmt"
	"testing"
)

func TestEvidenceInspectorBoundsHydrationWithoutTruncatingAggregates(
	t *testing.T,
) {
	service := newTestService(t)
	for index := range 52 {
		conclusion := "passed"
		if index == 0 {
			conclusion = "failed"
		}
		fixture := evidenceRelationshipFixture(
			t,
			fmt.Sprintf("%016x", index+1),
			"verification",
			conclusion,
			index+1,
		)
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("ingest %d = %#v", index, disposition)
		}
	}

	page, err := loadEvidenceRelationshipPage(
		t.Context(),
		service.db,
		"span",
		"2222222222222222",
		"verification",
		false,
		nil,
		1,
		"1970-01-01T00:00:00Z",
		"1970-01-01T00:00:00Z",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 2 {
		t.Fatalf("bounded query returned %d rows, want limit + 1", len(page))
	}

	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   "2222222222222222",
		},
		Role:  "verification",
		Limit: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if role.Status != "present" ||
		role.ActiveRecordCount != 52 ||
		len(role.Records) != 1 || !role.Conflicting ||
		role.Conclusion != "" || role.Cursor == "" || !role.Truncated {
		t.Fatalf("bounded role = %#v", role)
	}
	next, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: result.Subject,
			Role:    "verification",
			Limit:   1,
			Cursor:  role.Cursor,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if next.Roles.Verification.ActiveRecordCount != role.ActiveRecordCount {
		t.Fatalf(
			"cursor count = %d, want stable %d",
			next.Roles.Verification.ActiveRecordCount,
			role.ActiveRecordCount,
		)
	}
}

func TestEvidenceInspectorPreservesNanosecondAcceptanceOrder(
	t *testing.T,
) {
	service := newTestService(t)
	older := evidenceRelationshipFixture(
		t,
		"aaaaaaaaaaaaaaaa",
		"verification",
		"passed",
		1,
	)
	newer := evidenceRelationshipFixture(
		t,
		"1111111111111111",
		"verification",
		"passed",
		2,
	)
	for _, fixture := range []evidenceEdgeFixture{older, newer} {
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("ingest = %#v", disposition)
		}
	}
	for id, acceptedAt := range map[string]string{
		older.evidenceID: "2026-07-29T12:00:00.000000001Z",
		newer.evidenceID: "2026-07-29T12:00:00.000000002Z",
	} {
		if _, err := service.db.Exec(`
			UPDATE evidence_relationships
			SET relationship_accepted_at = ?
			WHERE evidence_id = ?
		`, acceptedAt, id); err != nil {
			t.Fatal(err)
		}
	}

	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   older.subject.ID,
		},
		Role:  "verification",
		Limit: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := result.Roles.Verification.Records[0].Ref.ID; got != newer.evidenceID {
		t.Fatalf("first record = %q, want chronologically newer %q", got, newer.evidenceID)
	}
}
