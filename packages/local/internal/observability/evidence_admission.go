package observability

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
)

// validateEvidenceRecordAdmission runs the shared immutable-identity guards
// before an existing evidence reservation may turn a retry into a no-op.
// It deliberately performs no writes; first acceptance still uses the normal
// stored-record path and commits all mutations in the caller's transaction.
func validateEvidenceRecordAdmission(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
) error {
	if err := validateEvidenceOperationAdmission(
		ctx,
		statements,
		record,
	); err != nil {
		return err
	}
	if err := validateEvidencePrivacyAdmission(
		ctx,
		statements,
		record,
	); err != nil {
		return err
	}
	if err := validateEvidenceRunIdentity(ctx, statements, record); err != nil {
		return err
	}
	if err := validateEvidenceRecordIdentity(ctx, statements, record); err != nil {
		return err
	}
	if err := validateSegmentOwnership(ctx, statements, record); err != nil {
		return err
	}
	return validateEvidenceSegmentSequence(ctx, statements, record)
}

func validateEvidenceOperationAdmission(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
) error {
	var deleted int
	if err := statements.queryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM operation_tombstones WHERE operation_id = ?
		)
	`, record.OperationID).Scan(&deleted); err != nil {
		return fmt.Errorf(
			"check operation tombstone %q: %w",
			record.OperationID,
			err,
		)
	}
	if deleted != 0 {
		return &operationDeletedError{operationID: record.OperationID}
	}
	return nil
}

func validateEvidenceRunIdentity(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
) error {
	var operationID string
	var traceID sql.NullString
	err := statements.queryRow(ctx, `
		SELECT operation_id, trace_id FROM runs WHERE run_id = ?
	`, record.RunID).Scan(&operationID, &traceID)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return fmt.Errorf(
			"load operation membership for run %q: %w",
			record.RunID,
			err,
		)
	}
	if operationID != record.OperationID {
		return fmt.Errorf(
			"operation_identity_conflict: run %s belongs to operation %s, not %s",
			record.RunID,
			operationID,
			record.OperationID,
		)
	}
	if traceID.Valid && record.TraceID != "" && traceID.String != record.TraceID {
		return fmt.Errorf(
			"trace_identity_conflict: run %s belongs to trace %s, not %s",
			record.RunID,
			traceID.String,
			record.TraceID,
		)
	}
	return nil
}

func validateEvidenceRecordIdentity(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
) error {
	existing, exists, err := existingRecordPayload(
		ctx,
		statements,
		record.RecordID,
	)
	if err != nil || !exists {
		return err
	}
	existingCanonical, err := canonicalJSON([]byte(existing))
	if err != nil {
		return fmt.Errorf(
			"canonicalize existing record payload %q: %w",
			record.RecordID,
			err,
		)
	}
	submittedCanonical, err := canonicalJSON(record.Payload)
	if err != nil {
		return fmt.Errorf("canonicalize record payload: %w", err)
	}
	if !bytes.Equal(existingCanonical, submittedCanonical) {
		return &recordIDConflictError{recordID: record.RecordID}
	}
	return nil
}

func validateEvidenceSegmentSequence(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
) error {
	var recordID string
	err := statements.queryRow(ctx, `
		SELECT record_id FROM records
		WHERE segment_id = ? AND segment_seq = ?
	`, record.SegmentID, record.SegmentSeq).Scan(&recordID)
	if err == sql.ErrNoRows || (err == nil && recordID == record.RecordID) {
		return nil
	}
	if err != nil {
		return fmt.Errorf(
			"check evidence segment sequence %s/%d: %w",
			record.SegmentID,
			record.SegmentSeq,
			err,
		)
	}
	return fmt.Errorf(
		"segment_sequence_conflict: segment %s sequence %d already identifies a different record",
		record.SegmentID,
		record.SegmentSeq,
	)
}
