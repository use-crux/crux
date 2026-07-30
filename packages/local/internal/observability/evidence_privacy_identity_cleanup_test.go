package observability

import (
	"encoding/json"
	"testing"
)

func TestEvidencePrivacyDeletionMatchesSubjectSourceAndProducer(t *testing.T) {
	for _, identity := range []string{"subject", "source", "producer"} {
		t.Run(identity, func(t *testing.T) {
			service := newTestService(t)
			seedEvidenceSurvivingSubject(t, service)
			deletedRunID := "run_deleted_" + identity
			ingestRunStart(
				t,
				service,
				deletedRunID,
				"seg_"+deletedRunID,
				"trace_"+deletedRunID,
				"running",
				"2026-07-29T10:10:00Z",
			)
			fixture := defaultEvidenceEdgeFixture(t)
			fixture.runID = "run_surviving_author"
			fixture.operationID = fixture.runID
			fixture.segmentID = "seg_surviving_author"
			fixture.producer = evidenceProducer{
				Kind: "run",
				ID:   fixture.runID,
			}
			switch identity {
			case "subject":
				fixture.subject = NodeRef{
					Kind: "run",
					ID:   deletedRunID,
				}
			case "source":
				seedPrivacySourceArtifact(
					t,
					service,
					deletedRunID,
					fixture.source.ID,
				)
			case "producer":
				fixture.producer = evidenceProducer{
					Kind: "run",
					ID:   deletedRunID,
				}
			}
			fixture.digest = evidenceFixtureDigest(t, fixture)
			if disposition := evidenceDisposition(
				t,
				service,
				evidenceEdgeTestRecord(t, fixture),
			); disposition.Outcome != "accepted" {
				t.Fatalf("evidence = %#v", disposition)
			}

			if _, err := service.DeleteRuns(
				t.Context(),
				[]string{deletedRunID},
			); err != nil {
				t.Fatal(err)
			}
			assertEvidenceQueryCount(
				t,
				service,
				"relationship",
				`SELECT count(*) FROM evidence_relationships
				 WHERE evidence_id = ?`,
				fixture.evidenceID,
				0,
			)
		})
	}
}

func TestEvidencePrivacyDeletionRemovesCoverageForDeletedSubject(t *testing.T) {
	service := newTestService(t)
	deletedRunID := "run_deleted_coverage_subject"
	ingestRunStart(
		t,
		service,
		deletedRunID,
		"seg_deleted_coverage_subject",
		"trace_deleted_coverage_subject",
		"running",
		"2026-07-29T10:10:00Z",
	)
	record := evidenceCoverageForOwner(
		t,
		1,
		"run_surviving_coverage_owner",
		"aaaaaaaaaaaaaaaa",
	)
	var payload map[string]any
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	attributes := payload["attributes"].(map[string]any)
	attributes["subject"] = map[string]any{
		"kind": "run",
		"id":   deletedRunID,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	record = mustRecord(t, string(encoded))
	if disposition := evidenceDisposition(
		t,
		service,
		record,
	); disposition.Outcome != "accepted" {
		t.Fatalf("coverage = %#v", disposition)
	}

	if _, err := service.DeleteRuns(
		t.Context(),
		[]string{deletedRunID},
	); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{
		"evidence_coverage_events",
		"evidence_coverage_projection",
		"evidence_subject_revisions",
		"evidence_truncation_watermarks",
	} {
		var count int
		if err := service.db.QueryRow(
			"SELECT count(*) FROM "+table+
				" WHERE subject_kind = 'run' AND subject_id = ?",
			deletedRunID,
		).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s retained %d deleted-subject rows", table, count)
		}
	}
}

func seedPrivacySourceArtifact(
	t *testing.T,
	service *Service,
	runID string,
	artifactID string,
) {
	t.Helper()
	record := mustRecord(t, `{
		"schemaVersion":5,
		"recordId":"rec_deleted_source_artifact",
		"type":"artifact",
		"operationId":"`+runID+`",
		"runId":"`+runID+`",
		"segmentId":"seg_deleted_source_artifact",
		"segmentSeq":1,
		"artifactId":"`+artifactID+`",
		"kind":"score.report",
		"createdAt":"2026-07-29T10:11:00Z",
		"contentType":"application/json",
		"encoding":"reference"
	}`)
	if err := service.Ingest(t.Context(), Batch{
		SchemaVersion: SchemaVersion,
		Records:       []Record{record},
	}); err != nil {
		t.Fatal(err)
	}
}
