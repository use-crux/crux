package observability

import "testing"

func TestEvidenceEdgeRejectsDuplicateSupersessionIdentity(t *testing.T) {
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.supersedes = []string{
		"evidence_4444444444444444",
		"evidence_4444444444444444",
	}
	fixture.digest = evidenceFixtureDigest(t, fixture)
	record := evidenceEdgeTestRecord(t, fixture)

	if err := ValidateRecord(record); err == nil {
		t.Fatal("duplicate supersession identity was accepted")
	}
}

func TestEvidenceEdgeRejectsUnknownSubjectNodeBeforeIngest(t *testing.T) {
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.subject = NodeRef{
		Kind: "effect.receipt",
		ID:   "receipt_future",
	}
	fixture.digest = evidenceFixtureDigest(t, fixture)

	if err := ValidateRecord(evidenceEdgeTestRecord(t, fixture)); err == nil {
		t.Fatal("unavailable effect receipt subject was accepted")
	}
}

func TestEvidenceEdgeRejectsNoncanonicalGraphNodesWithoutMutation(
	t *testing.T,
) {
	testCases := map[string]func(*evidenceEdgeFixture){
		"unknown source kind": func(fixture *evidenceEdgeFixture) {
			fixture.source = NodeRef{Kind: "effect.receipt", ID: "receipt_future"}
		},
		"unknown subject kind": func(fixture *evidenceEdgeFixture) {
			fixture.subject = NodeRef{Kind: "future.node", ID: "future"}
		},
		"empty run": func(fixture *evidenceEdgeFixture) {
			fixture.subject = NodeRef{Kind: "run"}
		},
		"empty artifact": func(fixture *evidenceEdgeFixture) {
			fixture.source = NodeRef{Kind: "artifact"}
		},
		"malformed span": func(fixture *evidenceEdgeFixture) {
			fixture.subject = NodeRef{Kind: "span", ID: "span_invalid"}
		},
		"zero span": func(fixture *evidenceEdgeFixture) {
			fixture.subject = NodeRef{Kind: "span", ID: "0000000000000000"}
		},
	}

	for name, mutate := range testCases {
		t.Run(name, func(t *testing.T) {
			service := newTestService(t)
			fixture := defaultEvidenceEdgeFixture(t)
			mutate(&fixture)
			fixture.digest = evidenceFixtureDigest(t, fixture)

			disposition := evidenceDisposition(
				t,
				service,
				evidenceEdgeTestRecord(t, fixture),
			)
			if disposition.Outcome != "rejected" ||
				disposition.Code != "invalid_record" ||
				disposition.Retryable {
				t.Fatalf("disposition = %#v", disposition)
			}
			for _, table := range []string{
				"evidence_reservations",
				"evidence_relationships",
				"edges",
				"records",
			} {
				assertEvidenceTableCount(t, service, table, 0)
			}
		})
	}
}
