package observability

import (
	"errors"
	"testing"
)

func TestEvidenceInspectorDistinguishesKnownAndUnknownSubjects(t *testing.T) {
	service := newTestService(t)
	runID := "run_111111111111111111111111"
	if _, err := service.db.Exec(`
		INSERT INTO runs (run_id, operation_id)
		VALUES (?, ?)
	`, runID, runID); err != nil {
		t.Fatal(err)
	}

	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{Kind: "execution", ID: runID},
		Role:    "verification",
		Limit:   50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Subject.ID != runID ||
		result.Roles.Intent.Role != "intent" ||
		len(result.Roles.Verification.Records) != 0 {
		t.Fatalf("known empty subject = %#v", result)
	}

	_, err = service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   "run_222222222222222222222222",
		},
		Role:  "verification",
		Limit: 50,
	})
	if !errors.Is(err, ErrEvidenceNotFound) {
		t.Fatalf("unknown subject error = %v", err)
	}
}
