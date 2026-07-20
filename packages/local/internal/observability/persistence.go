package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type recordIDConflictError struct {
	recordID string
}

type operationDeletedError struct {
	operationID string
}

func (e *operationDeletedError) Error() string {
	return fmt.Sprintf("operation_deleted: operation %s was explicitly deleted", e.operationID)
}

func (e *recordIDConflictError) Error() string {
	return fmt.Sprintf("record_id_conflict: record %s already exists with different canonical content", e.recordID)
}

func deleteRunRows(ctx context.Context, tx *sql.Tx, runIDs []string) error {
	placeholders := strings.TrimRight(strings.Repeat("?,", len(runIDs)), ",")
	args := make([]any, len(runIDs))
	for i, runID := range runIDs {
		args[i] = runID
	}
	tables := []string{
		"ingest_health",
		"run_segments",
		"records",
		"span_events",
		"artifacts",
		"edges",
		"spans",
		// run_definition_activity is a derived projection with no independent
		// retention/TTL: a run's activity rows must not survive that run's
		// deletion, so they are removed in the same transaction as the run.
		"run_definition_activity",
		"runs",
	}
	// observability_run_revision_log is deliberately NOT purged here: it is
	// the only durable record that a run was deleted. A reconnecting client
	// presenting a revision from before the deletion must see the run as
	// changed (binding spec 04 §4) so it fully invalidates instead of
	// keeping a phantom row forever. Callers bump a fresh tombstone revision
	// for these run IDs (via bumpRunRevisions) in the same transaction,
	// before calling this function — see DeleteRuns and runRetention. The
	// log has no foreign key on run_id, so rows referencing a now-deleted
	// run are harmless history and still age out under the normal bounded
	// retain-N-revisions prune in bumpRunRevisions/pruneRevisionLog.
	for _, table := range tables {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE run_id IN ("+placeholders+")", args...); err != nil {
			return fmt.Errorf("delete observability %s rows: %w", table, err)
		}
	}
	return nil
}

func (s *Service) configureSQLite(ctx context.Context) error {
	statements := []string{
		`PRAGMA auto_vacuum = INCREMENTAL`,
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("execute sqlite pragma %q: %w", statement, err)
		}
	}
	var autoVacuum int
	if err := s.db.QueryRowContext(ctx, `PRAGMA auto_vacuum`).Scan(&autoVacuum); err != nil {
		return fmt.Errorf("inspect sqlite auto_vacuum: %w", err)
	}
	if autoVacuum != 2 {
		if _, err := s.db.ExecContext(ctx, `PRAGMA auto_vacuum = INCREMENTAL`); err != nil {
			return fmt.Errorf("enable sqlite incremental auto_vacuum: %w", err)
		}
		if _, err := s.db.ExecContext(ctx, `VACUUM`); err != nil {
			return fmt.Errorf("vacuum sqlite for incremental auto_vacuum: %w", err)
		}
	}
	return nil
}

func upsertStoredRecord(ctx context.Context, statements *ingestStatements, record Record) (bool, error) {
	if err := ensureOperationMembership(ctx, statements, record); err != nil {
		return false, err
	}
	canonicalPayload, err := canonicalJSON(record.Payload)
	if err != nil {
		return false, fmt.Errorf("canonicalize record payload: %w", err)
	}
	existing, exists, err := existingRecordPayload(ctx, statements, record.RecordID)
	if err != nil {
		return false, err
	}
	if exists {
		existingCanonical, err := canonicalJSON([]byte(existing))
		if err != nil {
			return false, fmt.Errorf("canonicalize existing record payload %q: %w", record.RecordID, err)
		}
		if string(existingCanonical) != string(canonicalPayload) {
			return false, &recordIDConflictError{recordID: record.RecordID}
		}
		return false, nil
	}
	if err := validateSegmentOwnership(ctx, statements, record); err != nil {
		return false, err
	}
	result, err := statements.exec(ctx, `
		INSERT INTO records (record_id, run_id, operation_id, trace_id, segment_id, segment_seq, type, payload_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, record.RecordID, record.RunID, record.OperationID, nullIfEmpty(record.TraceID), record.SegmentID, record.SegmentSeq, record.Type, string(record.Payload))
	if err != nil {
		return false, classifySQLiteConstraintError(err, record)
	}
	inserted, err := rowsAffected(result)
	if err != nil {
		return false, err
	}
	if inserted {
		if err := upsertRunSegment(ctx, statements, record); err != nil {
			return false, err
		}
		return true, nil
	}
	return false, nil
}

func ensureOperationMembership(ctx context.Context, statements *ingestStatements, record Record) error {
	var deleted int
	if err := statements.queryRow(ctx, `SELECT EXISTS(SELECT 1 FROM operation_tombstones WHERE operation_id = ?)`, record.OperationID).Scan(&deleted); err != nil {
		return fmt.Errorf("check operation tombstone %q: %w", record.OperationID, err)
	}
	if deleted != 0 {
		return &operationDeletedError{operationID: record.OperationID}
	}
	if _, err := statements.exec(ctx, `
		INSERT INTO operations (operation_id, first_seen_at) VALUES (?, ?)
		ON CONFLICT(operation_id) DO NOTHING
	`, record.OperationID, operationFirstSeenAt(record)); err != nil {
		return fmt.Errorf("reserve operation %q: %w", record.OperationID, err)
	}

	var existingOperationID string
	var existingTraceID, existingParentRunID, existingTriggeredBySpanID sql.NullString
	err := statements.queryRow(ctx, `
		SELECT operation_id, trace_id, parent_run_id, triggered_by_span_id
		FROM runs WHERE run_id = ?
	`, record.RunID).Scan(&existingOperationID, &existingTraceID, &existingParentRunID, &existingTriggeredBySpanID)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("load operation membership for run %q: %w", record.RunID, err)
	}
	if err == sql.ErrNoRows {
		if _, err := statements.exec(ctx, `
			INSERT INTO runs (run_id, operation_id, trace_id) VALUES (?, ?, ?)
		`, record.RunID, record.OperationID, nullIfEmpty(record.TraceID)); err != nil {
			return fmt.Errorf("reserve operation member %q: %w", record.RunID, err)
		}
	} else {
		if existingOperationID != record.OperationID {
			return fmt.Errorf("operation_identity_conflict: run %s belongs to operation %s, not %s", record.RunID, existingOperationID, record.OperationID)
		}
		if existingTraceID.Valid && record.TraceID != "" && existingTraceID.String != record.TraceID {
			return fmt.Errorf("trace_identity_conflict: run %s belongs to trace %s, not %s", record.RunID, existingTraceID.String, record.TraceID)
		}
		if !existingTraceID.Valid && record.TraceID != "" {
			if _, err := statements.exec(ctx, `UPDATE runs SET trace_id = ? WHERE run_id = ?`, record.TraceID, record.RunID); err != nil {
				return err
			}
		}
	}

	if record.Type != RecordRunStart {
		return nil
	}
	var start RunStartRecord
	if err := json.Unmarshal(record.Payload, &start); err != nil {
		return fmt.Errorf("decode operation topology for run %q: %w", record.RunID, err)
	}
	if err != sql.ErrNoRows {
		if existingParentRunID.Valid && existingParentRunID.String != start.ParentRunID {
			return fmt.Errorf("parent_run_identity_conflict: run %s belongs to parent %s, not %s", record.RunID, existingParentRunID.String, start.ParentRunID)
		}
		if existingTriggeredBySpanID.Valid && existingTriggeredBySpanID.String != start.TriggeredBySpanID {
			return fmt.Errorf("trigger_span_identity_conflict: run %s was triggered by span %s, not %s", record.RunID, existingTriggeredBySpanID.String, start.TriggeredBySpanID)
		}
	}
	if _, err := statements.exec(ctx, `
		UPDATE runs SET
			parent_run_id = coalesce(parent_run_id, ?),
			triggered_by_span_id = coalesce(triggered_by_span_id, ?)
		WHERE run_id = ?
	`, nullIfEmpty(start.ParentRunID), nullIfEmpty(start.TriggeredBySpanID), record.RunID); err != nil {
		return err
	}
	if record.RunID == record.OperationID {
		if _, err := statements.exec(ctx, `UPDATE operations SET root_present = 1 WHERE operation_id = ?`, record.OperationID); err != nil {
			return err
		}
	}
	return nil
}

func operationFirstSeenAt(record Record) string {
	var fields map[string]any
	if json.Unmarshal(record.Payload, &fields) == nil {
		for _, key := range []string{"startedAt", "resumedAt", "suspendedAt", "endedAt", "timestamp", "createdAt"} {
			if value := stringMapField(fields, key); value != "" {
				return value
			}
		}
	}
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func validateSegmentOwnership(ctx context.Context, statements *ingestStatements, record Record) error {
	var existingRunID string
	err := statements.queryRow(ctx, `SELECT run_id FROM run_segments WHERE segment_id = ?`, record.SegmentID).Scan(&existingRunID)
	if err == nil {
		if existingRunID != record.RunID {
			return fmt.Errorf("segment_ownership_conflict: segment %s already belongs to run %s", record.SegmentID, existingRunID)
		}
		return nil
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("check segment ownership for %s: %w", record.SegmentID, err)
	}
	return nil
}

func classifySQLiteConstraintError(err error, record Record) error {
	message := err.Error()
	if strings.Contains(message, "idx_records_segment_seq_unique") ||
		strings.Contains(message, "records.segment_id, records.segment_seq") {
		return fmt.Errorf("segment_sequence_conflict: segment %s sequence %d already identifies a different record", record.SegmentID, record.SegmentSeq)
	}
	if strings.Contains(message, "records.record_id") {
		return &recordIDConflictError{recordID: record.RecordID}
	}
	if strings.Contains(message, "run_segments.segment_id") {
		return fmt.Errorf("segment_ownership_conflict: segment %s already belongs to another run", record.SegmentID)
	}
	return err
}

func upsertRunSegment(ctx context.Context, statements *ingestStatements, record Record) error {
	fields := segmentProjectionFields(record)
	_, err := statements.exec(ctx, `
		INSERT INTO run_segments (
			segment_id, run_id,
			status, started_at, resumed_at, suspended_at, ended_at, reason, previous_segment_id,
			first_segment_seq, last_segment_seq
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(segment_id) DO UPDATE SET
			status = CASE
				WHEN run_segments.status IN ('ok', 'error', 'blocked', 'cancelled') THEN run_segments.status
				WHEN run_segments.status = 'suspended' AND excluded.status = 'running' THEN run_segments.status
				WHEN excluded.status IN ('ok', 'error', 'blocked', 'cancelled', 'suspended') THEN excluded.status
				ELSE coalesce(excluded.status, run_segments.status)
			END,
			started_at = coalesce(run_segments.started_at, excluded.started_at),
			resumed_at = coalesce(run_segments.resumed_at, excluded.resumed_at),
			suspended_at = coalesce(run_segments.suspended_at, excluded.suspended_at),
			ended_at = CASE
				WHEN run_segments.status IN ('ok', 'error', 'blocked', 'cancelled') THEN run_segments.ended_at
				ELSE coalesce(run_segments.ended_at, excluded.ended_at)
			END,
			reason = coalesce(run_segments.reason, excluded.reason),
			previous_segment_id = coalesce(run_segments.previous_segment_id, excluded.previous_segment_id),
			first_segment_seq = CASE
				WHEN run_segments.first_segment_seq = 0 OR excluded.first_segment_seq < run_segments.first_segment_seq THEN excluded.first_segment_seq
				ELSE run_segments.first_segment_seq
			END,
			last_segment_seq = max(run_segments.last_segment_seq, excluded.last_segment_seq),
			gap_count = max(0, max(run_segments.last_segment_seq, excluded.last_segment_seq) -
				min(run_segments.first_segment_seq, excluded.first_segment_seq) + 1 -
				(SELECT count(*) FROM records WHERE segment_id = excluded.segment_id)),
			conflict_count = max(0,
				(SELECT count(*) FROM records WHERE segment_id = excluded.segment_id AND type = 'run:end') - 1)
	`, record.SegmentID, record.RunID, nullIfEmpty(fields.status), nullIfEmpty(fields.startedAt),
		nullIfEmpty(fields.resumedAt), nullIfEmpty(fields.suspendedAt), nullIfEmpty(fields.endedAt),
		nullIfEmpty(fields.reason), nullIfEmpty(fields.previousSegmentID), record.SegmentSeq, record.SegmentSeq)
	return err
}

// reconcileSegmentCounts recomputes a segment's gap_count/conflict_count from
// its stored records. Call once per distinct affected segment at the end of a
// batch rather than after every record insert, since each call scans every
// record belonging to the segment.
func reconcileSegmentCounts(ctx context.Context, statements *ingestStatements, segmentID string) error {
	_, err := statements.exec(ctx, `
		UPDATE run_segments
		SET gap_count = max(0, last_segment_seq - (SELECT count(*) FROM records WHERE segment_id = ?)),
			conflict_count = max(0, (SELECT count(*) FROM records WHERE segment_id = ? AND type = 'run:end') - 1)
		WHERE segment_id = ?
	`, segmentID, segmentID, segmentID)
	return err
}

func existingRecordPayload(ctx context.Context, statements *ingestStatements, recordID string) (string, bool, error) {
	var payload string
	if err := statements.queryRow(ctx, `SELECT payload_json FROM records WHERE record_id = ?`, recordID).Scan(&payload); err != nil {
		if err == sql.ErrNoRows {
			return "", false, nil
		}
		return "", false, fmt.Errorf("load existing record %q: %w", recordID, err)
	}
	return payload, true, nil
}

func canonicalJSON(raw []byte) ([]byte, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

type segmentProjection struct {
	status, startedAt, resumedAt, suspendedAt, endedAt, reason, previousSegmentID string
}

func segmentProjectionFields(record Record) segmentProjection {
	var fields map[string]any
	if err := json.Unmarshal(record.Payload, &fields); err != nil {
		return segmentProjection{}
	}
	switch record.Type {
	case RecordRunStart:
		return segmentProjection{status: "running", startedAt: stringMapField(fields, "startedAt")}
	case RecordRunSuspend:
		return segmentProjection{status: "suspended", suspendedAt: stringMapField(fields, "suspendedAt"), endedAt: stringMapField(fields, "suspendedAt"), reason: stringMapField(fields, "reason")}
	case RecordRunResume:
		return segmentProjection{status: "running", startedAt: stringMapField(fields, "resumedAt"), resumedAt: stringMapField(fields, "resumedAt"), reason: stringMapField(fields, "reason"), previousSegmentID: stringMapField(fields, "previousSegmentId")}
	case RecordRunEnd:
		return segmentProjection{status: stringMapField(fields, "status"), endedAt: stringMapField(fields, "endedAt")}
	default:
		return segmentProjection{}
	}
}

func stringMapField(fields map[string]any, key string) string {
	value, _ := fields[key].(string)
	return value
}

func (s *Service) ingestRecord(ctx context.Context, tx *sql.Tx, statements *ingestStatements, record Record) (err error) {
	storedInserted, err := upsertStoredRecord(ctx, statements, record)
	if err != nil {
		return err
	}
	if !storedInserted {
		return nil
	}
	if err := upsertRunDeployment(ctx, statements, record.RunID, record.Deployment); err != nil {
		return err
	}
	statements.markAffected(record.OperationID, record.RunID, record.SegmentID)
	// Project the runtime↔definition join in the same transaction as the record
	// ingest and the run-revision bump. A rollback undoes this write with
	// everything else; a duplicate record never reaches here (storedInserted is
	// false), so occurrence_count is not double-counted.
	if err := projectDefinitionActivity(ctx, statements, record); err != nil {
		return err
	}
	switch record.Type {
	case RecordRunStart:
		var run RunStartRecord
		if err := json.Unmarshal(record.Payload, &run); err != nil {
			return fmt.Errorf("decode run start record: %w", err)
		}
		if err := upsertRunStart(ctx, statements, run); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, rollupDeltaForRunStart(run, storedInserted))
	case RecordRunSuspend:
		var run RunSuspendRecord
		if err := json.Unmarshal(record.Payload, &run); err != nil {
			return fmt.Errorf("decode run suspend record: %w", err)
		}
		if err := upsertRunBoundary(ctx, statements, run.RunID, run.OperationID, run.TraceID, run.Attributes); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, runRollupDelta{runID: run.RunID, recordCount: 1, lastActivityAt: run.SuspendedAt})
	case RecordRunResume:
		var run RunResumeRecord
		if err := json.Unmarshal(record.Payload, &run); err != nil {
			return fmt.Errorf("decode run resume record: %w", err)
		}
		if err := upsertRunBoundary(ctx, statements, run.RunID, run.OperationID, run.TraceID, run.Attributes); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, runRollupDelta{runID: run.RunID, recordCount: 1, lastActivityAt: run.ResumedAt})
	case RecordRunEnd:
		var run RunEndRecord
		if err := json.Unmarshal(record.Payload, &run); err != nil {
			return fmt.Errorf("decode run end record: %w", err)
		}
		if err := upsertRunEnd(ctx, statements, run); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, rollupDeltaForRunEnd(run, storedInserted))
	case RecordSpanStart:
		var span SpanStartRecord
		if err := json.Unmarshal(record.Payload, &span); err != nil {
			return fmt.Errorf("decode span start record: %w", err)
		}
		spanInserted, err := reserveSpanRollup(ctx, statements, span.RunID, span.SpanID)
		if err != nil {
			return err
		}
		if err := upsertSpanStart(ctx, statements, span); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, rollupDeltaForSpanStart(span, storedInserted, spanInserted))
	case RecordSpanEnd:
		var span SpanEndRecord
		if err := json.Unmarshal(record.Payload, &span); err != nil {
			return fmt.Errorf("decode span end record: %w", err)
		}
		rollupUsage, err := shouldRollupSpanMetrics(ctx, tx, span.SpanID)
		if err != nil {
			return err
		}
		spanInserted, err := reserveSpanRollup(ctx, statements, span.RunID, span.SpanID)
		if err != nil {
			return err
		}
		if err := upsertSpanEnd(ctx, statements, span); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, rollupDeltaForSpanEnd(span, storedInserted, spanInserted, rollupUsage))
	case RecordSpanEvent:
		var event SpanEventRecord
		if err := json.Unmarshal(record.Payload, &event); err != nil {
			return fmt.Errorf("decode span event record: %w", err)
		}
		rollupUsage, err := shouldRollupUsageEvent(ctx, tx, event)
		if err != nil {
			return err
		}
		if err := upsertSpanEvent(ctx, statements, event); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, rollupDeltaForSpanEvent(event, storedInserted, storedInserted, rollupUsage))
	case RecordArtifact:
		var artifact ArtifactRecord
		if err := json.Unmarshal(record.Payload, &artifact); err != nil {
			return fmt.Errorf("decode artifact record: %w", err)
		}
		if err := upsertArtifact(ctx, statements, artifact); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, rollupDeltaForArtifact(artifact, storedInserted, storedInserted))
	case RecordEdge:
		var edge EdgeRecord
		if err := json.Unmarshal(record.Payload, &edge); err != nil {
			return fmt.Errorf("decode edge record: %w", err)
		}
		if err := upsertEdge(ctx, statements, edge); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, rollupDeltaForEdge(edge, storedInserted, storedInserted))
	case RecordSpan:
		var span SpanRecord
		if err := json.Unmarshal(record.Payload, &span); err != nil {
			return fmt.Errorf("decode span record: %w", err)
		}
		rollupUsage, err := shouldRollupSpanMetrics(ctx, tx, span.SpanID)
		if err != nil {
			return err
		}
		spanInserted, err := reserveSpanRollup(ctx, statements, span.RunID, span.SpanID)
		if err != nil {
			return err
		}
		if err := upsertSpan(ctx, statements, span); err != nil {
			return err
		}
		return updateRunRollups(ctx, statements, rollupDeltaForSpan(span, storedInserted, spanInserted, rollupUsage))
	default:
		return updateRunRollups(ctx, statements, rollupDeltaForUnknown(record, storedInserted))
	}
}

func upsertRunDeployment(
	ctx context.Context,
	statements *ingestStatements,
	runID string,
	deployment *DeploymentIdentity,
) error {
	var projectID, manifestID, deploymentID sql.NullString
	var observed int
	err := statements.queryRow(ctx, `
		SELECT project_id, manifest_id, deployment_id, deployment_observed FROM runs WHERE run_id = ?
	`, runID).Scan(&projectID, &manifestID, &deploymentID, &observed)
	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("load deployment identity for run %q: %w", runID, err)
	}
	if err == nil {
		if observed == 0 {
			if deployment == nil {
				_, err = statements.exec(ctx, `UPDATE runs SET deployment_observed = 1 WHERE run_id = ?`, runID)
				return err
			}
			_, err = statements.exec(ctx, `
				UPDATE runs SET project_id = ?, manifest_id = ?, deployment_id = ?, deployment_observed = 1 WHERE run_id = ?
			`, deployment.ProjectID, nullIfEmpty(deployment.ManifestID), nullIfEmpty(deployment.DeploymentID), runID)
			return err
		}
		if deployment == nil {
			if projectID.Valid || manifestID.Valid || deploymentID.Valid {
				return fmt.Errorf("deployment_identity_conflict: run %s removed deployment identity", runID)
			}
			return nil
		}
		if !projectID.Valid ||
			projectID.String != deployment.ProjectID ||
			manifestID.String != deployment.ManifestID ||
			deploymentID.String != deployment.DeploymentID {
			return fmt.Errorf("deployment_identity_conflict: run %s changed deployment identity", runID)
		}
		return nil
	}
	return fmt.Errorf("operation member %q was not reserved before deployment projection", runID)
}

func reserveSpanRollup(ctx context.Context, statements *ingestStatements, runID string, spanID string) (bool, error) {
	result, err := statements.exec(ctx, `
		INSERT INTO spans (span_id, run_id)
		VALUES (?, ?)
		ON CONFLICT(span_id) DO NOTHING
	`, spanID, runID)
	if err != nil {
		return false, fmt.Errorf("reserve observability span rollup %q: %w", spanID, err)
	}
	return rowsAffected(result)
}

func rowsAffected(result sql.Result) (bool, error) {
	count, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read sqlite affected row count: %w", err)
	}
	return count > 0, nil
}

func shouldRollupSpanMetrics(ctx context.Context, tx *sql.Tx, spanID string) (bool, error) {
	var exists int
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM span_events
			WHERE span_id = ? AND name = 'usage.observed'
		)
	`, spanID).Scan(&exists); err != nil {
		return false, fmt.Errorf("check usage event rollup for span %q: %w", spanID, err)
	}
	return exists == 0, nil
}

func shouldRollupUsageEvent(ctx context.Context, tx *sql.Tx, event SpanEventRecord) (bool, error) {
	if event.Name != "usage.observed" {
		return false, nil
	}
	var exists int
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM spans
			WHERE span_id = ?
				AND metrics_json IS NOT NULL
				AND metrics_json != ''
				AND metrics_json != 'null'
		)
	`, event.SpanID).Scan(&exists); err != nil {
		return false, fmt.Errorf("check span metric rollup for event %q: %w", event.EventID, err)
	}
	return exists == 0, nil
}

func upsertRunStart(ctx context.Context, statements *ingestStatements, run RunStartRecord) error {
	_, err := statements.exec(ctx, `
		INSERT INTO runs (run_id, operation_id, parent_run_id, triggered_by_span_id, trace_id, session_id, user_id, name, root_primitive, status, started_at, attributes_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(run_id) DO UPDATE SET
			trace_id = coalesce(excluded.trace_id, runs.trace_id),
			session_id = coalesce(excluded.session_id, runs.session_id),
			user_id = coalesce(excluded.user_id, runs.user_id),
			name = excluded.name,
			root_primitive = excluded.root_primitive,
			status = CASE WHEN runs.status IS NULL OR runs.status = 'running' THEN excluded.status ELSE runs.status END,
			started_at = excluded.started_at,
				attributes_json = CASE
					WHEN runs.attributes_json IS NOT NULL AND excluded.attributes_json IS NOT NULL THEN json_patch(runs.attributes_json, excluded.attributes_json)
					ELSE coalesce(excluded.attributes_json, runs.attributes_json)
				END
	`, run.RunID, run.OperationID, nullIfEmpty(run.ParentRunID), nullIfEmpty(run.TriggeredBySpanID), nullIfEmpty(run.TraceID), nullIfEmpty(run.SessionID), nullIfEmpty(run.UserID), run.Name, run.RootPrimitive, run.Status, run.StartedAt, nullJSON(run.Attributes))
	return err
}

func upsertRunEnd(ctx context.Context, statements *ingestStatements, run RunEndRecord) error {
	_, err := statements.exec(ctx, `
		INSERT INTO runs (run_id, operation_id, trace_id, status, ended_at, duration_ms, metrics_json, error_json, attributes_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(run_id) DO UPDATE SET
			trace_id = coalesce(excluded.trace_id, runs.trace_id),
			status = CASE
				WHEN runs.status IN ('ok', 'error', 'blocked', 'cancelled') THEN runs.status
				ELSE excluded.status
			END,
			ended_at = CASE
				WHEN runs.status IN ('ok', 'error', 'blocked', 'cancelled') THEN runs.ended_at
				ELSE excluded.ended_at
			END,
			duration_ms = CASE
				WHEN runs.status IN ('ok', 'error', 'blocked', 'cancelled') THEN runs.duration_ms
				ELSE excluded.duration_ms
			END,
			metrics_json = CASE
				WHEN runs.status IN ('ok', 'error', 'blocked', 'cancelled') THEN runs.metrics_json
				ELSE coalesce(excluded.metrics_json, runs.metrics_json)
			END,
			error_json = CASE
				WHEN runs.status IN ('ok', 'error', 'blocked', 'cancelled') THEN runs.error_json
				ELSE coalesce(excluded.error_json, runs.error_json)
			END,
				attributes_json = CASE
					WHEN runs.status IN ('ok', 'error', 'blocked', 'cancelled') THEN runs.attributes_json
					WHEN runs.attributes_json IS NOT NULL AND excluded.attributes_json IS NOT NULL THEN json_patch(runs.attributes_json, excluded.attributes_json)
					ELSE coalesce(excluded.attributes_json, runs.attributes_json)
				END
	`, run.RunID, run.OperationID, nullIfEmpty(run.TraceID), run.Status, run.EndedAt, run.DurationMs, nullJSON(run.Metrics), nullJSON(run.Error), nullJSON(run.Attributes))
	return err
}

func upsertSpanStart(ctx context.Context, statements *ingestStatements, span SpanStartRecord) error {
	var parentSpanID interface{}
	if span.ParentSpanID != nil && *span.ParentSpanID != "" {
		parentSpanID = *span.ParentSpanID
	}
	_, err := statements.exec(ctx, `
		INSERT INTO spans (
			span_id, run_id, trace_id, parent_span_id, family, primitive, name, status, started_at,
			model, provider, prompt_id, context_id, agent_id, tool_name, flow_id, step_id, memory_id,
			retriever_id, attributes_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(span_id) DO UPDATE SET
			run_id = excluded.run_id,
			trace_id = coalesce(excluded.trace_id, spans.trace_id),
			parent_span_id = coalesce(excluded.parent_span_id, spans.parent_span_id),
			family = excluded.family,
			primitive = excluded.primitive,
			name = excluded.name,
			status = CASE WHEN spans.status IS NULL OR spans.status = 'running' THEN excluded.status ELSE spans.status END,
			started_at = excluded.started_at,
			model = coalesce(excluded.model, spans.model),
			provider = coalesce(excluded.provider, spans.provider),
			prompt_id = coalesce(excluded.prompt_id, spans.prompt_id),
			context_id = coalesce(excluded.context_id, spans.context_id),
			agent_id = coalesce(excluded.agent_id, spans.agent_id),
			tool_name = coalesce(excluded.tool_name, spans.tool_name),
			flow_id = coalesce(excluded.flow_id, spans.flow_id),
			step_id = coalesce(excluded.step_id, spans.step_id),
			memory_id = coalesce(excluded.memory_id, spans.memory_id),
			retriever_id = coalesce(excluded.retriever_id, spans.retriever_id),
				attributes_json = CASE
					WHEN spans.attributes_json IS NOT NULL AND excluded.attributes_json IS NOT NULL THEN json_patch(spans.attributes_json, excluded.attributes_json)
					ELSE coalesce(excluded.attributes_json, spans.attributes_json)
				END
	`, span.SpanID, span.RunID, nullIfEmpty(span.TraceID), parentSpanID, span.Family, span.Primitive, span.Name, span.Status, span.StartedAt, nullIfEmpty(span.Model), nullIfEmpty(span.Provider), nullIfEmpty(span.PromptID), nullIfEmpty(span.ContextID), nullIfEmpty(span.AgentID), nullIfEmpty(span.ToolName), nullIfEmpty(span.FlowID), nullIfEmpty(span.StepID), nullIfEmpty(span.MemoryID), nullIfEmpty(span.RetrieverID), nullJSON(span.Attributes))
	return err
}

func upsertSpan(ctx context.Context, statements *ingestStatements, span SpanRecord) error {
	var parentSpanID interface{}
	if span.ParentSpanID != nil && *span.ParentSpanID != "" {
		parentSpanID = *span.ParentSpanID
	}
	_, err := statements.exec(ctx, `
		INSERT INTO spans (
			span_id, run_id, trace_id, parent_span_id, family, primitive, name, status, started_at,
			ended_at, duration_ms, model, provider, prompt_id, context_id, agent_id, tool_name,
			flow_id, step_id, memory_id, retriever_id, attributes_json, metrics_json, error_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(span_id) DO UPDATE SET
			run_id = excluded.run_id,
			trace_id = coalesce(excluded.trace_id, spans.trace_id),
			parent_span_id = coalesce(excluded.parent_span_id, spans.parent_span_id),
			family = excluded.family,
			primitive = excluded.primitive,
			name = excluded.name,
			status = excluded.status,
			started_at = excluded.started_at,
			ended_at = coalesce(excluded.ended_at, spans.ended_at),
			duration_ms = coalesce(excluded.duration_ms, spans.duration_ms),
			model = coalesce(excluded.model, spans.model),
			provider = coalesce(excluded.provider, spans.provider),
			prompt_id = coalesce(excluded.prompt_id, spans.prompt_id),
			context_id = coalesce(excluded.context_id, spans.context_id),
			agent_id = coalesce(excluded.agent_id, spans.agent_id),
			tool_name = coalesce(excluded.tool_name, spans.tool_name),
			flow_id = coalesce(excluded.flow_id, spans.flow_id),
			step_id = coalesce(excluded.step_id, spans.step_id),
			memory_id = coalesce(excluded.memory_id, spans.memory_id),
			retriever_id = coalesce(excluded.retriever_id, spans.retriever_id),
				attributes_json = CASE
					WHEN spans.attributes_json IS NOT NULL AND excluded.attributes_json IS NOT NULL THEN json_patch(spans.attributes_json, excluded.attributes_json)
					ELSE coalesce(excluded.attributes_json, spans.attributes_json)
				END,
			metrics_json = coalesce(excluded.metrics_json, spans.metrics_json),
			error_json = coalesce(excluded.error_json, spans.error_json)
	`, span.SpanID, span.RunID, nullIfEmpty(span.TraceID), parentSpanID, span.Family, span.Primitive, span.Name, span.Status, span.StartedAt, nullIfEmpty(span.EndedAt), nullFloat64(span.DurationMs), nullIfEmpty(span.Model), nullIfEmpty(span.Provider), nullIfEmpty(span.PromptID), nullIfEmpty(span.ContextID), nullIfEmpty(span.AgentID), nullIfEmpty(span.ToolName), nullIfEmpty(span.FlowID), nullIfEmpty(span.StepID), nullIfEmpty(span.MemoryID), nullIfEmpty(span.RetrieverID), nullJSON(span.Attributes), nullJSON(span.Metrics), nullJSON(span.Error))
	return err
}

func upsertSpanEnd(ctx context.Context, statements *ingestStatements, span SpanEndRecord) error {
	_, err := statements.exec(ctx, `
		INSERT INTO spans (span_id, run_id, trace_id, status, ended_at, duration_ms, metrics_json, error_json, attributes_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(span_id) DO UPDATE SET
			run_id = excluded.run_id,
			trace_id = coalesce(excluded.trace_id, spans.trace_id),
			status = excluded.status,
			ended_at = excluded.ended_at,
			duration_ms = excluded.duration_ms,
			metrics_json = coalesce(excluded.metrics_json, spans.metrics_json),
			error_json = coalesce(excluded.error_json, spans.error_json),
				attributes_json = CASE
					WHEN spans.attributes_json IS NOT NULL AND excluded.attributes_json IS NOT NULL THEN json_patch(spans.attributes_json, excluded.attributes_json)
					ELSE coalesce(excluded.attributes_json, spans.attributes_json)
				END
	`, span.SpanID, span.RunID, nullIfEmpty(span.TraceID), span.Status, span.EndedAt, span.DurationMs, nullJSON(span.Metrics), nullJSON(span.Error), nullJSON(span.Attributes))
	return err
}

func upsertSpanEvent(ctx context.Context, statements *ingestStatements, event SpanEventRecord) error {
	_, err := statements.exec(ctx, `
		INSERT INTO span_events (event_id, run_id, trace_id, span_id, name, timestamp, attributes_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(event_id) DO UPDATE SET
			run_id = excluded.run_id,
			trace_id = excluded.trace_id,
			span_id = excluded.span_id,
			name = excluded.name,
			timestamp = excluded.timestamp,
			attributes_json = excluded.attributes_json
	`, event.EventID, event.RunID, nullIfEmpty(event.TraceID), event.SpanID, event.Name, event.Timestamp, nullJSON(event.Attributes))
	return err
}

func enforceTokenChunkRing(ctx context.Context, statements *ingestStatements, spanID string) error {
	_, err := statements.exec(ctx, `
		DELETE FROM span_events
		WHERE span_id = ? AND name = ?
			AND event_id NOT IN (
				SELECT event_id
				FROM span_events
				WHERE span_id = ? AND name = ?
				ORDER BY timestamp DESC, event_id DESC
				LIMIT ?
			)
	`, spanID, tokenChunkEventName, spanID, tokenChunkEventName, tokenChunkRingLimit)
	if err != nil {
		return fmt.Errorf("enforce token chunk ring for span %q: %w", spanID, err)
	}
	return nil
}

func upsertArtifact(ctx context.Context, statements *ingestStatements, artifact ArtifactRecord) error {
	_, err := statements.exec(ctx, `
		INSERT INTO artifacts (
			artifact_id, run_id, trace_id, span_id, kind, created_at, content_type, encoding,
			size_bytes, hash, preview_json, uri, attributes_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(artifact_id) DO UPDATE SET
			run_id = excluded.run_id,
			trace_id = excluded.trace_id,
			span_id = excluded.span_id,
			kind = excluded.kind,
			created_at = excluded.created_at,
			content_type = excluded.content_type,
			encoding = excluded.encoding,
			size_bytes = excluded.size_bytes,
			hash = excluded.hash,
			preview_json = excluded.preview_json,
			uri = excluded.uri,
			attributes_json = excluded.attributes_json
	`, artifact.ArtifactID, artifact.RunID, nullIfEmpty(artifact.TraceID), nullIfEmpty(artifact.SpanID), artifact.Kind, artifact.CreatedAt, artifact.ContentType, artifact.Encoding, nullInt64(artifact.SizeBytes), nullIfEmpty(artifact.Hash), nullJSON(artifact.Preview), nullIfEmpty(artifact.URI), nullJSON(artifact.Attributes))
	return err
}

func upsertEdge(ctx context.Context, statements *ingestStatements, edge EdgeRecord) error {
	_, err := statements.exec(ctx, `
		INSERT INTO edges (edge_id, run_id, trace_id, edge_type, from_kind, from_id, to_kind, to_id, created_at, attributes_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(edge_id) DO UPDATE SET
			run_id = excluded.run_id,
			trace_id = excluded.trace_id,
			edge_type = excluded.edge_type,
			from_kind = excluded.from_kind,
			from_id = excluded.from_id,
			to_kind = excluded.to_kind,
			to_id = excluded.to_id,
			created_at = excluded.created_at,
			attributes_json = excluded.attributes_json
	`, edge.EdgeID, edge.RunID, nullIfEmpty(edge.TraceID), edge.EdgeType, edge.From.Kind, edge.From.ID, edge.To.Kind, edge.To.ID, edge.CreatedAt, nullJSON(edge.Attributes))
	return err
}
