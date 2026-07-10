package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type recordIDConflictError struct {
	recordID string
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
		"runs",
	}
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
		INSERT INTO records (record_id, run_id, trace_id, segment_id, segment_seq, type, payload_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, record.RecordID, record.RunID, nullIfEmpty(record.TraceID), record.SegmentID, record.SegmentSeq, record.Type, string(record.Payload))
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
	status, startedAt, endedAt := segmentProjectionFields(record)
	_, err := statements.exec(ctx, `
		INSERT INTO run_segments (
			segment_id, run_id,
			status, started_at, ended_at, first_segment_seq, last_segment_seq
		)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(segment_id) DO UPDATE SET
			status = CASE
				WHEN run_segments.status IN ('ok', 'error', 'blocked', 'cancelled') THEN run_segments.status
				WHEN excluded.status IN ('ok', 'error', 'blocked', 'cancelled', 'suspended') THEN excluded.status
				ELSE coalesce(excluded.status, run_segments.status)
			END,
			started_at = coalesce(run_segments.started_at, excluded.started_at),
			ended_at = CASE
				WHEN run_segments.status IN ('ok', 'error', 'blocked', 'cancelled') THEN run_segments.ended_at
				WHEN run_segments.status = 'suspended'
					AND excluded.status IN ('ok', 'error', 'blocked', 'cancelled') THEN excluded.ended_at
				ELSE coalesce(run_segments.ended_at, excluded.ended_at)
			END,
			first_segment_seq = CASE
				WHEN run_segments.first_segment_seq = 0 OR excluded.first_segment_seq < run_segments.first_segment_seq THEN excluded.first_segment_seq
				ELSE run_segments.first_segment_seq
			END,
			last_segment_seq = max(run_segments.last_segment_seq, excluded.last_segment_seq)
	`, record.SegmentID, record.RunID, nullIfEmpty(status), nullIfEmpty(startedAt), nullIfEmpty(endedAt), record.SegmentSeq, record.SegmentSeq)
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

func segmentProjectionFields(record Record) (status, startedAt, endedAt string) {
	var fields map[string]any
	if err := json.Unmarshal(record.Payload, &fields); err != nil {
		return "", "", ""
	}
	switch record.Type {
	case RecordRunStart:
		return "running", stringMapField(fields, "startedAt"), ""
	case RecordRunEnd:
		return stringMapField(fields, "status"), "", stringMapField(fields, "endedAt")
	default:
		return "", "", ""
	}
}

func stringMapField(fields map[string]any, key string) string {
	value, _ := fields[key].(string)
	return value
}

func (s *Service) ingestRecord(ctx context.Context, tx *sql.Tx, statements *ingestStatements, record Record) error {
	storedInserted, err := upsertStoredRecord(ctx, statements, record)
	if err != nil {
		return err
	}
	if !storedInserted {
		return nil
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
		INSERT INTO runs (run_id, trace_id, session_id, user_id, name, root_primitive, status, started_at, attributes_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	`, run.RunID, nullIfEmpty(run.TraceID), nullIfEmpty(run.SessionID), nullIfEmpty(run.UserID), run.Name, run.RootPrimitive, run.Status, run.StartedAt, nullJSON(run.Attributes))
	return err
}

func upsertRunEnd(ctx context.Context, statements *ingestStatements, run RunEndRecord) error {
	_, err := statements.exec(ctx, `
		INSERT INTO runs (run_id, trace_id, status, ended_at, duration_ms, metrics_json, error_json, attributes_json)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
	`, run.RunID, nullIfEmpty(run.TraceID), run.Status, run.EndedAt, run.DurationMs, nullJSON(run.Metrics), nullJSON(run.Error), nullJSON(run.Attributes))
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
