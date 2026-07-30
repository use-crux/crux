package observability

import (
	"encoding/json"
	"testing"
)

func TestEvidencePrivacyDeletionWatermarksRemovedHistory(t *testing.T) {
	service := newTestService(t)
	seedEvidenceSurvivingSubject(t, service)

	predecessor := evidenceRelationshipFixture(
		t,
		"aaaaaaaaaaaaaaaa",
		"verification",
		"failed",
		1,
	)
	predecessor.producer = evidenceProducer{
		Kind: "run",
		ID:   predecessor.runID,
	}
	predecessor.digest = evidenceFixtureDigest(t, predecessor)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, predecessor),
	); disposition.Outcome != "accepted" {
		t.Fatalf("predecessor = %#v", disposition)
	}

	successor := evidenceRelationshipFixture(
		t,
		"bbbbbbbbbbbbbbbb",
		"verification",
		"passed",
		1,
	)
	successor.runID = "run_history_successor"
	successor.operationID = successor.runID
	successor.segmentID = "seg_history_successor"
	successor.producer = evidenceProducer{Kind: "run", ID: successor.runID}
	successor.supersedes = []string{predecessor.evidenceID}
	successor.digest = evidenceFixtureDigest(t, successor)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, successor),
	); disposition.Outcome != "accepted" {
		t.Fatalf("successor = %#v", disposition)
	}

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{predecessor.operationID},
	); err != nil {
		t.Fatal(err)
	}
	assertEvidenceQueryCount(
		t,
		service,
		"successor",
		`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
		successor.evidenceID,
		1,
	)
	var watermark int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_truncation_watermarks
		WHERE subject_kind = ? AND subject_id = ? AND role = ?
	`, predecessor.subject.Kind, predecessor.subject.ID,
		predecessor.role).Scan(&watermark); err != nil {
		t.Fatal(err)
	}
	if watermark != 1 {
		t.Fatalf("history watermark = %d, want 1", watermark)
	}
}

func TestEvidencePrivacyCoverageSupportControlsWatermark(t *testing.T) {
	service := newTestService(t)
	seedEvidenceSurvivingSubject(t, service)
	first := evidenceCoverageForOwner(
		t,
		1,
		"run_coverage_owner_a",
		"aaaaaaaaaaaaaaaa",
	)
	second := evidenceCoverageForOwner(
		t,
		2,
		"run_coverage_owner_b",
		"bbbbbbbbbbbbbbbb",
	)
	for _, record := range []Record{first, second} {
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("coverage = %#v", disposition)
		}
	}

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{"run_coverage_owner_a"},
	); err != nil {
		t.Fatal(err)
	}
	assertCoveragePrivacyState(t, service, 1, 0)

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{"run_coverage_owner_b"},
	); err != nil {
		t.Fatal(err)
	}
	assertCoveragePrivacyState(t, service, 0, 1)
}

func evidenceCoverageForOwner(
	t *testing.T,
	index int,
	runID string,
	spanID string,
) Record {
	t.Helper()
	base := evidenceCoverageProjectionRecord(t, index, "not-configured")
	var payload map[string]any
	if err := json.Unmarshal(base.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	payload["recordId"] = "rec_" + runID
	payload["operationId"] = runID
	payload["runId"] = runID
	payload["segmentId"] = "seg_" + runID
	payload["segmentSeq"] = 1
	payload["spanId"] = spanID
	payload["eventId"] = "event_" + runID
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return mustRecord(t, string(encoded))
}

func assertCoveragePrivacyState(
	t *testing.T,
	service *Service,
	supports int,
	watermarks int,
) {
	t.Helper()
	var actualSupports int
	if err := service.db.QueryRow(`
		SELECT coalesce(sum(support_count), 0)
		FROM evidence_coverage_projection
		WHERE subject_kind = 'span'
		  AND subject_id = '2222222222222222'
		  AND role = 'verification'
	`).Scan(&actualSupports); err != nil {
		t.Fatal(err)
	}
	if actualSupports != supports {
		t.Fatalf("coverage supports = %d, want %d", actualSupports, supports)
	}
	var actualWatermarks int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_truncation_watermarks
		WHERE subject_kind = 'span'
		  AND subject_id = '2222222222222222'
		  AND role = 'verification'
	`).Scan(&actualWatermarks); err != nil {
		t.Fatal(err)
	}
	if actualWatermarks != watermarks {
		t.Fatalf("watermarks = %d, want %d", actualWatermarks, watermarks)
	}
}
