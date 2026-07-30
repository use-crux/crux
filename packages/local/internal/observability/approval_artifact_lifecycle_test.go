package observability

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestApprovalArtifactPrivacySelectorGoldenDigests(t *testing.T) {
	occurrence := approvalArtifactOccurrence{
		Domain:        "crux.tool.approval",
		IdentityEpoch: 1,
		Namespace: approvalArtifactNamespace{
			OperationID: "run_original_operation",
			RunID:       "run_original_request",
		},
		ApprovalID: "approval_call",
		Slot:       "decision",
	}
	baseDigest, err := approvalOccurrenceBaseDigest(occurrence)
	if err != nil {
		t.Fatal(err)
	}
	vectors := []struct {
		name   string
		actual string
		want   string
	}{
		{
			name:   approvalSelectorBaseOccurrence,
			actual: baseDigest,
			want:   "sha256:e2f4b2fc428535d8d43409d4c2c7db02b60de9f7d5a4f3beb4b2d7ea75b18730",
		},
		{
			name: approvalSelectorBaseOperation,
			actual: approvalArtifactSelectorDigest(
				approvalSelectorBaseOperation,
				"run_original_operation",
			),
			want: "sha256:91ceea5849cdd6d5071073c6d01b07f3189e1a6a26d645b5556059f4b8ea4a25",
		},
		{
			name: approvalSelectorBaseRun,
			actual: approvalArtifactSelectorDigest(
				approvalSelectorBaseRun,
				"run_original_request",
			),
			want: "sha256:4c1c6b85e8e92663da3f81f937608d9fbeb2f7e2991636f4b0b5ee0211418d9a",
		},
		{
			name: approvalSelectorProducerOperation,
			actual: approvalArtifactSelectorDigest(
				approvalSelectorProducerOperation,
				"run_current",
			),
			want: "sha256:a722ceb1fac33b3ccb97d5e6e7ba8b2e1fbea4f15d87e9e23495b6bd0cf5225d",
		},
		{
			name: approvalSelectorProducerRun,
			actual: approvalArtifactSelectorDigest(
				approvalSelectorProducerRun,
				"run_current",
			),
			want: "sha256:6802a2d3361bc9de3919fa881a24083e6267c3b5f276434fea3a2b80336227b0",
		},
		{
			name: approvalSelectorProducerSpan,
			actual: approvalArtifactSelectorDigest(
				approvalSelectorProducerSpan,
				"span_current",
			),
			want: "sha256:6a598f5e7a367f8784b3bfd61affdcfabac38d8e3bab318d1bfd00bf8a1abc58",
		},
	}
	for _, vector := range vectors {
		if vector.actual != vector.want {
			t.Errorf("%s digest = %q, want %q", vector.name, vector.actual, vector.want)
		}
	}
}

func TestApprovalArtifactRoutineRetentionCompactsToIdentityOnly(t *testing.T) {
	service := newTestService(t)
	runID := "run_retained_approval"
	artifact := approvalDecisionArtifactRecord(
		t,
		"rec_approval_retained",
		runID,
		"seg_retained_approval",
		2,
		map[string]any{"status": "approved"},
	)
	var artifactPayload map[string]any
	if err := json.Unmarshal(artifact.Payload, &artifactPayload); err != nil {
		t.Fatal(err)
	}
	artifactPayload["createdAt"] = "2026-07-01T00:00:00.500Z"
	artifact.Payload, _ = json.Marshal(artifactPayload)
	for _, record := range []Record{
		mustRecord(t, `{
			"schemaVersion":5,
			"recordId":"rec_retained_approval_start",
			"type":"run:start",
			"operationId":"run_retained_approval",
			"runId":"run_retained_approval",
			"segmentId":"seg_retained_approval",
			"segmentSeq":1,
			"traceId":"11111111111111111111111111111111",
			"name":"approval",
			"rootPrimitive":"tool.approval",
			"startedAt":"2026-07-01T00:00:00Z",
			"status":"running"
		}`),
		artifact,
		mustRecord(t, `{
			"schemaVersion":5,
			"recordId":"rec_retained_approval_end",
			"type":"run:end",
			"operationId":"run_retained_approval",
			"runId":"run_retained_approval",
			"segmentId":"seg_retained_approval",
			"segmentSeq":3,
			"traceId":"11111111111111111111111111111111",
			"endedAt":"2026-07-01T00:00:01Z",
			"status":"ok"
		}`),
	} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("initial disposition = %#v", disposition)
		}
	}
	if _, err := service.runRetention(
		context.Background(),
		retentionSettings{
			MaxRunAge:       14 * 24 * time.Hour,
			MaxRuns:         defaultRetentionMaxRuns,
			PreviewMaxBytes: defaultArtifactPreviewMaxBytes,
		},
		time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
	); err != nil {
		t.Fatal(err)
	}

	var state string
	var semanticDigest, recordID, acceptedAt any
	if err := service.db.QueryRow(`
		SELECT state, semantic_digest, artifact_record_id, accepted_at
		FROM approval_artifact_occurrences
	`).Scan(&state, &semanticDigest, &recordID, &acceptedAt); err != nil {
		t.Fatal(err)
	}
	if state != "retained-out" ||
		semanticDigest != nil ||
		recordID != nil ||
		acceptedAt != nil {
		t.Fatalf(
			"retained-out occurrence = %q/%v/%v/%v",
			state,
			semanticDigest,
			recordID,
			acceptedAt,
		)
	}
	assertEvidenceTableCount(
		t,
		service,
		"approval_artifact_privacy_selectors",
		5,
	)
	var serializedSelectors string
	if err := service.db.QueryRow(`
		SELECT group_concat(selector_digest, ',')
		FROM approval_artifact_privacy_selectors
	`).Scan(&serializedSelectors); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{
		"approval_call",
		"run_original_operation",
		"run_original_request",
		runID,
	} {
		if strings.Contains(serializedSelectors, secret) {
			t.Fatalf("private selector retained raw identity %q", secret)
		}
	}
	assertEvidenceTableCount(t, service, "artifacts", 0)

	retry := approvalDecisionArtifactRecord(
		t,
		"rec_approval_retained_retry",
		"run_retry_after_retention",
		"seg_retry_after_retention",
		1,
		map[string]any{"status": "denied"},
	)
	if disposition := evidenceDisposition(t, service, retry); disposition.Outcome != "accepted" {
		t.Fatalf("retained-out retry disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 1)
	assertEvidenceTableCount(t, service, "artifacts", 0)
	assertEvidenceTableCount(t, service, "records", 0)
}

func TestRetainedOutApprovalArtifactBaseDeletionUsesPrivateSelectors(
	t *testing.T,
) {
	service := newTestService(t)
	original := approvalRunStartRecord(
		t,
		"run_original_operation",
		"seg_original_operation",
	)
	producer := approvalRunStartRecord(
		t,
		"run_retained_decision",
		"seg_retained_decision",
	)
	artifact := approvalDecisionArtifactRecord(
		t,
		"rec_retained_decision",
		"run_retained_decision",
		"seg_retained_decision",
		2,
		map[string]any{"status": "approved"},
	)
	for _, record := range []Record{original, producer, artifact} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("seed disposition = %#v", disposition)
		}
	}
	retainOutApprovalArtifactForTest(t, service, "run_retained_decision")

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{"run_original_operation"},
	); err != nil {
		t.Fatal(err)
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 0)
	assertEvidenceTableCount(
		t,
		service,
		"approval_artifact_privacy_selectors",
		0,
	)

	retry := approvalDecisionArtifactRecord(
		t,
		"rec_retained_decision_retry",
		"run_later_retry",
		"seg_later_retry",
		1,
		map[string]any{"status": "approved"},
	)
	disposition := evidenceDisposition(t, service, retry)
	if disposition.Code != evidencePrivacyDeletedCode ||
		disposition.Retryable {
		t.Fatalf("retained-out base retry disposition = %#v", disposition)
	}
}

func TestRetainedOutApprovalArtifactProducerDeletionUsesPrivateSelectors(
	t *testing.T,
) {
	service := newTestService(t)
	producer := approvalRunStartRecord(
		t,
		"run_retained_producer",
		"seg_retained_producer",
	)
	artifact := approvalDecisionArtifactRecord(
		t,
		"rec_retained_producer",
		"run_retained_producer",
		"seg_retained_producer",
		2,
		map[string]any{"status": "denied"},
	)
	for _, record := range []Record{producer, artifact} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("seed disposition = %#v", disposition)
		}
	}
	retainOutApprovalArtifactForTest(t, service, "run_retained_producer")

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{"run_retained_producer"},
	); err != nil {
		t.Fatal(err)
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 0)
	assertEvidenceTableCount(
		t,
		service,
		"approval_artifact_privacy_selectors",
		0,
	)

	retry := approvalDecisionArtifactRecord(
		t,
		"rec_retained_producer_retry",
		"run_later_retry",
		"seg_later_retry",
		1,
		map[string]any{"status": "denied"},
	)
	disposition := evidenceDisposition(t, service, retry)
	if disposition.Code != evidencePrivacyDeletedCode ||
		disposition.Retryable {
		t.Fatalf("retained-out producer retry disposition = %#v", disposition)
	}
}

func retainOutApprovalArtifactForTest(
	t *testing.T,
	service *Service,
	runID string,
) {
	t.Helper()
	tx, err := service.db.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := retainOutApprovalArtifacts(
		t.Context(),
		tx,
		[]string{runID},
	); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	for _, table := range []string{"artifacts", "records"} {
		if _, err := tx.ExecContext(
			t.Context(),
			"DELETE FROM "+table+" WHERE run_id = ?",
			runID,
		); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestRetainedOutApprovalArtifactSuppressesAuthorityEdgeReplay(t *testing.T) {
	service := newTestService(t)
	artifact := approvalDecisionArtifactRecord(
		t,
		"rec_approval_source",
		"run_approval_source",
		"seg_approval_source",
		1,
		map[string]any{"status": "approved"},
	)
	if disposition := evidenceDisposition(t, service, artifact); disposition.Outcome != "accepted" {
		t.Fatalf("artifact disposition = %#v", disposition)
	}
	var parsed ArtifactRecord
	if err := json.Unmarshal(artifact.Payload, &parsed); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		UPDATE approval_artifact_occurrences
		SET state = 'retained-out', semantic_digest = NULL,
			artifact_record_id = NULL, accepted_at = NULL
	`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(
		`DELETE FROM records WHERE record_id = ?`,
		artifact.RecordID,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(
		`DELETE FROM artifacts WHERE artifact_id = ?`,
		parsed.ArtifactID,
	); err != nil {
		t.Fatal(err)
	}

	fixture := defaultEvidenceEdgeFixture(t)
	fixture.recordID = "rec_retained_authority"
	fixture.edgeID = "edge_retained_authority"
	fixture.evidenceID = "evidence_7777777777777777"
	fixture.source = NodeRef{Kind: "artifact", ID: parsed.ArtifactID}
	fixture.role = "authority"
	fixture.evidenceKind = "approval.decision"
	fixture.conclusion = "allowed"
	fixture.supersedes = nil
	fixture.nonIdempotent = true
	disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, fixture))
	if disposition.Outcome != "accepted" {
		t.Fatalf("edge disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_reservations", 0)
	assertEvidenceTableCount(t, service, "evidence_relationships", 0)
	assertEvidenceTableCount(t, service, "edges", 0)
}

func TestApprovalArtifactProducerDeletionCreatesSlotTombstone(t *testing.T) {
	service := newTestService(t)
	runID := "run_private_approval_producer"
	start := approvalRunStartRecord(
		t,
		runID,
		"seg_private_approval_producer",
	)
	artifact := approvalDecisionArtifactRecord(
		t,
		"rec_private_approval",
		runID,
		"seg_private_approval_producer",
		2,
		map[string]any{"status": "approved"},
	)
	for _, record := range []Record{start, artifact} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("seed disposition = %#v", disposition)
		}
	}
	if _, err := service.DeleteRuns(t.Context(), []string{runID}); err != nil {
		t.Fatal(err)
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 0)
	assertEvidenceTableCount(t, service, "artifacts", 0)

	retry := approvalDecisionArtifactRecord(
		t,
		"rec_private_approval_retry",
		"run_private_approval_retry",
		"seg_private_approval_retry",
		1,
		map[string]any{"status": "approved"},
	)
	disposition := evidenceDisposition(t, service, retry)
	if disposition.Code != evidencePrivacyDeletedCode ||
		disposition.Retryable {
		t.Fatalf("slot retry disposition = %#v", disposition)
	}
}

func TestApprovalArtifactOriginalNamespaceDeletionCreatesBaseTombstone(
	t *testing.T,
) {
	service := newTestService(t)
	original := approvalRunStartRecord(
		t,
		"run_original_operation",
		"seg_original_operation",
	)
	artifact := approvalDecisionArtifactRecord(
		t,
		"rec_cross_run_approval",
		"run_later_decision",
		"seg_later_decision",
		1,
		map[string]any{"status": "denied"},
	)
	for _, record := range []Record{original, artifact} {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("seed disposition = %#v", disposition)
		}
	}
	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{"run_original_operation"},
	); err != nil {
		t.Fatal(err)
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 0)
	assertEvidenceTableCount(t, service, "artifacts", 0)

	retry := approvalDecisionArtifactRecord(
		t,
		"rec_cross_run_approval_retry",
		"run_another_decision",
		"seg_another_decision",
		1,
		map[string]any{"status": "denied"},
	)
	disposition := evidenceDisposition(t, service, retry)
	if disposition.Code != evidencePrivacyDeletedCode ||
		disposition.Retryable {
		t.Fatalf("base retry disposition = %#v", disposition)
	}
}

func TestApprovalArtifactBaseDeletionRemovesEveryOccurrenceSlot(t *testing.T) {
	service := newTestService(t)
	namespace := approvalArtifactNamespace{
		OperationID: "run_approval_base",
		RunID:       "run_approval_base",
	}
	requestMarker := approvalArtifactAttributes{
		ApprovalOccurrence: approvalArtifactOccurrence{
			Domain:        "crux.tool.approval",
			IdentityEpoch: 1,
			Namespace:     namespace,
			ApprovalID:    "approval_two_slots",
			Slot:          "request",
		},
	}
	decisionMarker := requestMarker
	decisionMarker.ApprovalOccurrence.Slot = "decision"
	records := []Record{
		approvalRunStartRecord(
			t,
			namespace.RunID,
			"seg_approval_base",
		),
		approvalArtifactRecord(
			t,
			"rec_approval_request_slot",
			namespace.OperationID,
			namespace.RunID,
			"seg_approval_base",
			2,
			"approval.request",
			requestMarker,
			map[string]any{"status": "requested"},
		),
		approvalArtifactRecord(
			t,
			"rec_approval_decision_slot",
			"run_decision_producer",
			"run_decision_producer",
			"seg_decision_producer",
			1,
			"approval.decision",
			decisionMarker,
			map[string]any{"status": "approved"},
		),
	}
	for _, record := range records {
		if disposition := evidenceDisposition(t, service, record); disposition.Outcome != "accepted" {
			t.Fatalf("seed disposition = %#v", disposition)
		}
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 2)

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{namespace.RunID},
	); err != nil {
		t.Fatal(err)
	}
	assertEvidenceTableCount(t, service, "approval_artifact_occurrences", 0)
	assertEvidenceTableCount(
		t,
		service,
		"approval_artifact_privacy_selectors",
		0,
	)
	assertEvidenceTableCount(t, service, "artifacts", 0)
}
