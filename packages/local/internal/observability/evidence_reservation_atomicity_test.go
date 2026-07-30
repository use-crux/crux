package observability

import (
	"encoding/json"
	"testing"
)

func TestEvidenceReservationRollsBackWhenCanonicalEdgeInsertFails(t *testing.T) {
	service := newTestService(t)
	generic := mustRecord(t, `{
		"schemaVersion": 5,
		"recordId": "rec_existing_edge",
		"type": "edge",
		"operationId": "run_evidence_reservation",
		"runId": "run_evidence_reservation",
		"segmentId": "seg_evidence_reservation",
		"segmentSeq": 1,
		"edgeId": "edge_collision",
		"edgeType": "derived.from",
		"from": {"kind": "artifact", "id": "artifact_existing"},
		"to": {"kind": "span", "id": "2222222222222222"},
		"createdAt": "2026-07-29T10:00:00Z"
	}`)
	if err := service.Ingest(
		t.Context(),
		Batch{SchemaVersion: SchemaVersion, Records: []Record{generic}},
	); err != nil {
		t.Fatal(err)
	}
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.recordID = "rec_evidence_edge_collision"
	fixture.edgeID = "edge_collision"
	fixture.segmentSeq = 2
	disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, fixture))
	if disposition.Code != evidenceIdempotencyConflictCode {
		t.Fatalf("disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_reservations", 0)
	assertEvidenceTableCount(t, service, "evidence_relationships", 0)
	assertEvidenceTableCount(t, service, "records", 1)
	assertEvidenceTableCount(t, service, "edges", 1)
}

func TestEvidenceReservationRollsBackWhenReadProjectionInsertFails(t *testing.T) {
	service := newTestService(t)
	if _, err := service.db.Exec(`
		CREATE TRIGGER fail_evidence_relationship_insert
		BEFORE INSERT ON evidence_relationships
		BEGIN
			SELECT RAISE(ABORT, 'forced evidence projection failure');
		END
	`); err != nil {
		t.Fatal(err)
	}
	fixture := defaultEvidenceEdgeFixture(t)
	disposition := evidenceDisposition(t, service, evidenceEdgeTestRecord(t, fixture))
	if disposition.Outcome != "rejected" || !disposition.Retryable {
		t.Fatalf("disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_reservations", 0)
	assertEvidenceTableCount(t, service, "evidence_relationships", 0)
	assertEvidenceTableCount(t, service, "records", 0)
	assertEvidenceTableCount(t, service, "edges", 0)
}

func TestEvidenceReservationRetryHonorsOperationTombstone(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}
	if _, err := service.db.Exec(
		`INSERT INTO operation_tombstones (operation_id, deleted_at)
		 VALUES (?, ?)`,
		"run_evidence_reservation",
		"2026-07-29T12:00:00Z",
	); err != nil {
		t.Fatal(err)
	}

	retry := fixture
	retry.recordID = "rec_evidence_deleted_operation_retry"
	retry.edgeID = "edge_evidence_deleted_operation_retry"
	retry.segmentSeq = 2
	disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, retry),
	)
	if disposition.Outcome != "rejected" ||
		disposition.Code != "operation_deleted" ||
		disposition.Retryable {
		t.Fatalf("retry disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_reservations", 1)
	assertEvidenceTableCount(t, service, "edges", 1)
}

func TestEvidenceReservationRetryHonorsRecordIdentity(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("first disposition = %#v", disposition)
	}

	conflict := fixture
	conflict.edgeID = "edge_conflicting_record_identity"
	disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, conflict),
	)
	if disposition.Outcome != "rejected" ||
		disposition.Code != "record_id_conflict" ||
		disposition.Retryable {
		t.Fatalf("conflict disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_reservations", 1)
	assertEvidenceTableCount(t, service, "edges", 1)
}

func TestEvidenceReservationMaterializesEdgeWhenRawRecordAlreadyExists(
	t *testing.T,
) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	record := evidenceEdgeTestRecord(t, fixture)
	if _, err := service.db.Exec(`
		INSERT INTO operations (operation_id, first_seen_at) VALUES (?, ?)
	`, record.OperationID, fixture.recordedAt); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		INSERT INTO runs (run_id, operation_id, trace_id) VALUES (?, ?, ?)
	`, record.RunID, record.OperationID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		INSERT INTO run_segments (
			segment_id, run_id, first_segment_seq, last_segment_seq
		) VALUES (?, ?, ?, ?)
	`, record.SegmentID, record.RunID, record.SegmentSeq, record.SegmentSeq); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(json.RawMessage(record.Payload))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		INSERT INTO records (
			record_id, run_id, operation_id, segment_id, segment_seq,
			type, payload_json
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`, record.RecordID, record.RunID, record.OperationID, record.SegmentID,
		record.SegmentSeq, record.Type, string(payload)); err != nil {
		t.Fatal(err)
	}

	disposition := evidenceDisposition(t, service, record)
	if disposition.Outcome != "accepted" {
		t.Fatalf("disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_reservations", 1)
	assertEvidenceTableCount(t, service, "evidence_relationships", 1)
	assertEvidenceTableCount(t, service, "edges", 1)
}
