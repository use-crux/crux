package observability

import (
	"errors"
	"testing"
	"time"
)

func TestEvidenceInspectorCursorInvalidatesAtLogicalRetentionBoundary(
	t *testing.T,
) {
	now := time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	first := evidenceRelationshipFixture(
		t, "7777777777777771", "verification", "passed", 1,
	)
	acceptEvidenceFixture(t, service, first)

	now = now.Add(2 * time.Hour)
	second := evidenceRelationshipFixture(
		t, "7777777777777772", "verification", "passed", 2,
	)
	second.recordedAt = formatEvidenceAcceptanceTime(now)
	second.observedAt = formatEvidenceAcceptanceTime(now)
	second.digest = evidenceFixtureDigest(t, second)
	acceptEvidenceFixture(t, service, second)

	request := EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   first.subject.ID,
		},
		Role:  "verification",
		Limit: 1,
	}
	page, err := service.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	request.Cursor = page.Roles.Verification.Cursor
	if request.Cursor == "" {
		t.Fatal("missing first-page cursor")
	}

	now = now.Add(time.Hour + time.Minute)
	// Suppress physical cleanup to prove logical expiry alone invalidates the
	// snapshot, even before retention has a chance to bump its revision.
	service.evidenceReadCleanupAt.Store(now.UnixNano())
	if _, err := service.InspectEvidence(
		t.Context(),
		request,
	); !errors.Is(err, ErrEvidenceCursorInvalid) {
		t.Fatalf("logically expired cursor error = %v", err)
	}
}
