package observability

import (
	"encoding/json"
	"testing"
)

func TestEvidencePrivacyDeletionRejectsEveryQualifiedRecordForm(t *testing.T) {
	fixture := defaultEvidenceEdgeFixture(t)
	for _, testCase := range []struct {
		name      string
		record    Record
		operation string
	}{
		{
			name:      "relationship",
			record:    evidenceEdgeTestRecord(t, fixture),
			operation: fixture.operationID,
		},
		{
			name:      "artifact",
			record:    evidenceSourceArtifactTestRecord(t),
			operation: "run_evidence",
		},
		{
			name:      "coverage",
			record:    evidenceCoverageProjectionRecord(t, 1, "not-configured"),
			operation: "run_coverage_projection",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			service := newTestService(t)
			if testCase.name == "artifact" {
				ingestRunStart(
					t,
					service,
					"run_evidence",
					"seg_artifact_owner",
					"trace_artifact_owner",
					"running",
					"2026-07-29T11:59:00Z",
				)
			}
			if disposition := evidenceDisposition(
				t,
				service,
				testCase.record,
			); disposition.Outcome != "accepted" {
				t.Fatalf("seed = %#v", disposition)
			}
			if _, err := service.DeleteRuns(
				t.Context(),
				[]string{testCase.operation},
			); err != nil {
				t.Fatal(err)
			}
			retry := moveEvidenceRecordToOperation(
				t,
				testCase.record,
				"retry_"+testCase.name,
				1,
			)
			disposition := evidenceDisposition(t, service, retry)
			if disposition.Outcome != "rejected" ||
				disposition.Code != evidencePrivacyDeletedCode ||
				disposition.Retryable ||
				disposition.Message != evidencePrivacyDeletedMessage {
				t.Fatalf("disposition = %#v", disposition)
			}
		})
	}
}

func TestEvidencePrivacyTombstonePrecedesDuplicatesAndConflicts(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	edge := evidenceEdgeTestRecord(t, fixture)
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("seed = %#v", disposition)
	}
	if _, err := service.DeleteRuns(t.Context(), []string{fixture.operationID}); err != nil {
		t.Fatal(err)
	}

	identical := moveEvidenceRecordToOperation(t, edge, "retry_identical", 1)
	conflicting := mutateEvidenceEdgeForPrivacyRetry(
		t,
		edge,
		"retry_conflicting",
		"failed",
	)
	for _, retry := range []Record{identical, conflicting} {
		disposition := evidenceDisposition(t, service, retry)
		if disposition.Code != evidencePrivacyDeletedCode || disposition.Retryable {
			t.Fatalf("privacy retry = %#v", disposition)
		}
	}
}

func TestOperationDeletionPrecedesEvidencePrivacyTombstone(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	edge := evidenceEdgeTestRecord(t, fixture)
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("seed = %#v", disposition)
	}
	if _, err := service.DeleteRuns(t.Context(), []string{fixture.operationID}); err != nil {
		t.Fatal(err)
	}
	disposition := evidenceDisposition(t, service, edge)
	if disposition.Code != "operation_deleted" || disposition.Retryable {
		t.Fatalf("same-operation retry = %#v", disposition)
	}
}

func TestEvidencePrivacyRejectionPerformsNoReadModelMutation(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	edge := evidenceEdgeTestRecord(t, fixture)
	if disposition := evidenceDisposition(t, service, edge); disposition.Outcome != "accepted" {
		t.Fatalf("seed = %#v", disposition)
	}
	if _, err := service.DeleteRuns(t.Context(), []string{fixture.operationID}); err != nil {
		t.Fatal(err)
	}
	retry := moveEvidenceRecordToOperation(t, edge, "privacy_no_mutation", 1)
	before := evidencePrivacyMutationCounts(t, service)
	if disposition := evidenceDisposition(
		t,
		service,
		retry,
	); disposition.Code != evidencePrivacyDeletedCode {
		t.Fatalf("retry = %#v", disposition)
	}
	after := evidencePrivacyMutationCounts(t, service)
	if before != after {
		t.Fatalf("read-model counts changed: before=%#v after=%#v", before, after)
	}
	assertEvidenceQueryCount(
		t,
		service,
		"retry operation",
		`SELECT count(*) FROM operations WHERE operation_id = ?`,
		retry.OperationID,
		0,
	)
	assertEvidenceQueryCount(
		t,
		service,
		"retry record",
		`SELECT count(*) FROM records WHERE record_id = ?`,
		retry.RecordID,
		0,
	)
}

type privacyMutationCounts struct {
	reservations  int
	relationships int
	staging       int
	coverage      int
	revisions     int
	watermarks    int
}

func evidencePrivacyMutationCounts(
	t *testing.T,
	service *Service,
) privacyMutationCounts {
	t.Helper()
	var counts privacyMutationCounts
	for query, destination := range map[string]*int{
		"SELECT count(*) FROM evidence_reservations":          &counts.reservations,
		"SELECT count(*) FROM evidence_relationships":         &counts.relationships,
		"SELECT count(*) FROM evidence_staging_candidates":    &counts.staging,
		"SELECT count(*) FROM evidence_coverage_projection":   &counts.coverage,
		"SELECT count(*) FROM evidence_subject_revisions":     &counts.revisions,
		"SELECT count(*) FROM evidence_truncation_watermarks": &counts.watermarks,
	} {
		if err := service.db.QueryRow(query).Scan(destination); err != nil {
			t.Fatal(err)
		}
	}
	return counts
}

func moveEvidenceRecordToOperation(
	t *testing.T,
	record Record,
	suffix string,
	segmentSeq int,
) Record {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	runID := "run_" + suffix
	payload["recordId"] = "rec_" + suffix
	payload["operationId"] = runID
	payload["runId"] = runID
	payload["segmentId"] = "seg_" + suffix
	payload["segmentSeq"] = segmentSeq
	if record.Type == RecordSpanEvent {
		payload["eventId"] = "event_" + suffix
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return mustRecord(t, string(encoded))
}

func mutateEvidenceEdgeForPrivacyRetry(
	t *testing.T,
	record Record,
	suffix string,
	conclusion string,
) Record {
	t.Helper()
	retry := moveEvidenceRecordToOperation(t, record, suffix, 1)
	var payload map[string]any
	if err := json.Unmarshal(retry.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	attributes := payload["attributes"].(map[string]any)
	attributes["conclusion"] = conclusion
	attributes["contentDigest"] = "sha256:" +
		"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return mustRecord(t, string(encoded))
}
