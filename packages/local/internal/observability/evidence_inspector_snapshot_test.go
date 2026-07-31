package observability

import (
	"path/filepath"
	"testing"
)

func TestEvidenceInspectorReadsOneSQLiteSnapshot(t *testing.T) {
	t.Setenv("CRUX_OBSERVABILITY_RETENTION_DAYS", "36500")
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	reader, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reader.Close() })
	writer, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = writer.Close() })
	first := evidenceRelationshipFixture(
		t, "1111111111111111", "verification", "passed", 1,
	)
	second := evidenceRelationshipFixture(
		t, "2222222222222222", "verification", "failed", 2,
	)
	if disposition := evidenceDisposition(
		t,
		reader,
		evidenceEdgeTestRecord(t, first),
	); disposition.Outcome != "accepted" {
		t.Fatalf("first = %#v", disposition)
	}
	reader.evidenceInspectAfterSummaries = func() {
		reader.evidenceInspectAfterSummaries = nil
		if disposition := evidenceDisposition(
			t,
			writer,
			evidenceEdgeTestRecord(t, second),
		); disposition.Outcome != "accepted" {
			t.Fatalf("concurrent mutation = %#v", disposition)
		}
	}

	result, err := reader.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   first.subject.ID,
		},
		Role:  "verification",
		Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if len(role.Records) != 1 ||
		role.Records[0].Ref.ID != first.evidenceID ||
		role.Conflicting {
		t.Fatalf("mixed read snapshot = %#v", role)
	}
}
