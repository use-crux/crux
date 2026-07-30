package observability

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestEvidenceInspectorRejectsLimitsAndMisboundCursors(t *testing.T) {
	service := newTestService(t)
	firstFixture := evidenceRelationshipFixture(
		t,
		"7777777777777777",
		"verification",
		"passed",
		1,
	)
	secondFixture := evidenceRelationshipFixture(
		t,
		"8888888888888888",
		"verification",
		"passed",
		2,
	)
	for _, fixture := range []evidenceEdgeFixture{firstFixture, secondFixture} {
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("ingest = %#v", disposition)
		}
	}
	subject := EvidenceInspectSubject{
		Kind: "execution",
		ID:   firstFixture.subject.ID,
	}
	for _, limit := range []int{0, 51, -1} {
		if _, err := service.InspectEvidence(
			t.Context(),
			EvidenceInspectRequest{Subject: subject, Limit: limit},
		); err == nil {
			t.Fatalf("limit %d was accepted", limit)
		}
	}
	if _, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: subject,
			Limit:   1,
			Cursor:  strings.Repeat("c", 4_097),
		},
	); !errors.Is(err, ErrEvidenceCursorInvalid) {
		t.Fatalf("oversized cursor error = %v", err)
	}

	request := EvidenceInspectRequest{
		Subject: subject,
		Role:    "verification",
		Limit:   1,
	}
	first, err := service.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	request.Cursor = first.Roles.Verification.Cursor
	request.IncludeData = true
	if _, err := service.InspectEvidence(
		t.Context(),
		request,
	); !errors.Is(err, ErrEvidenceCursorInvalid) {
		t.Fatalf("option-mismatched cursor error = %v", err)
	}
}

func TestEvidenceInspectorCursorSurvivesRestart(t *testing.T) {
	t.Setenv("CRUX_OBSERVABILITY_RETENTION_DAYS", "36500")
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	first, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	fixtures := []evidenceEdgeFixture{
		evidenceRelationshipFixture(
			t,
			"9999999999999999",
			"verification",
			"passed",
			1,
		),
		evidenceRelationshipFixture(
			t,
			"aaaaaaaaaaaaaaa1",
			"verification",
			"failed",
			2,
		),
	}
	for _, fixture := range fixtures {
		if disposition := evidenceDisposition(
			t,
			first,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("ingest = %#v", disposition)
		}
	}
	request := EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   fixtures[0].subject.ID,
		},
		Role:  "verification",
		Limit: 1,
	}
	page, err := first.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	request.Cursor = page.Roles.Verification.Cursor
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	next, err := reopened.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(next.Roles.Verification.Records) != 1 ||
		next.Roles.Verification.Status != "present" ||
		!next.Roles.Verification.Conflicting ||
		next.Roles.Verification.Conclusion != "" ||
		!next.Roles.Verification.Truncated ||
		next.Roles.Verification.Records[0].Ref.ID ==
			page.Roles.Verification.Records[0].Ref.ID {
		t.Fatalf("restart page = %#v", next.Roles.Verification)
	}
}

func TestEvidenceInspectorCursorIsKeysetBoundToSubjectRevision(
	t *testing.T,
) {
	service := newTestService(t)
	fixtures := []evidenceEdgeFixture{
		evidenceRelationshipFixture(
			t, "1111111111111111", "verification", "passed", 1,
		),
		evidenceRelationshipFixture(
			t, "2222222222222222", "verification", "passed", 2,
		),
		evidenceRelationshipFixture(
			t, "3333333333333333", "verification", "passed", 3,
		),
	}
	for _, fixture := range fixtures {
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("ingest = %#v", disposition)
		}
	}
	request := EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   fixtures[0].subject.ID,
		},
		Role:  "verification",
		Limit: 1,
	}
	first, err := service.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	firstRole := first.Roles.Verification
	if len(firstRole.Records) != 1 ||
		firstRole.Cursor == "" ||
		len(firstRole.Cursor) > 4_096 {
		t.Fatalf("first page = %#v", firstRole)
	}
	request.Cursor = firstRole.Cursor
	second, err := service.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Roles.Verification.Records) != 1 ||
		second.Roles.Verification.Records[0].Ref.ID ==
			firstRole.Records[0].Ref.ID {
		t.Fatalf("second page = %#v", second.Roles.Verification)
	}

	mutation := evidenceRelationshipFixture(
		t, "4444444444444444", "verification", "passed", 4,
	)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, mutation),
	); disposition.Outcome != "accepted" {
		t.Fatalf("mutation = %#v", disposition)
	}
	if _, err := service.InspectEvidence(
		t.Context(),
		request,
	); !errors.Is(err, ErrEvidenceCursorInvalid) {
		t.Fatalf("stale cursor error = %v", err)
	}
}

func TestEvidenceInspectorCursorInvalidatesOnDirectPayloadHydration(
	t *testing.T,
) {
	service := newTestService(t)
	other := evidenceRelationshipFixture(
		t, "5555555555555555", "verification", "passed", 1,
	)
	target := evidenceRelationshipFixture(
		t, "6666666666666666", "verification", "passed", 2,
	)
	target.sourceMode = "inline"
	target.captureState = "available"
	target.digest = evidenceFixtureDigestWithPreview(
		t,
		target,
		`{"approved":true}`,
	)
	for _, fixture := range []evidenceEdgeFixture{other, target} {
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("edge = %#v", disposition)
		}
	}
	request := EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   target.subject.ID,
		},
		Role:        "verification",
		Limit:       1,
		IncludeData: true,
	}
	first, err := service.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	request.Cursor = first.Roles.Verification.Cursor
	if request.Cursor == "" {
		t.Fatal("missing first-page cursor")
	}
	artifact := evidenceInlineArtifactRecord(
		t,
		target,
		`{"approved":true}`,
	)
	artifact = mutateRecordSegmentSequence(t, artifact, 3)
	if disposition := evidenceDisposition(
		t,
		service,
		artifact,
	); disposition.Outcome != "accepted" {
		t.Fatalf("artifact = %#v", disposition)
	}
	if _, err := service.InspectEvidence(
		t.Context(),
		request,
	); !errors.Is(err, ErrEvidenceCursorInvalid) {
		t.Fatalf("hydrated cursor error = %v", err)
	}
}
