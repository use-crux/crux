package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

func (s *Service) migrate(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS records (
			record_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			seq INTEGER NOT NULL DEFAULT 0,
			type TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_records_run_id ON records(run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_records_run_received ON records(run_id, received_at, record_id)`,
		`CREATE TABLE IF NOT EXISTS runs (
			run_id TEXT PRIMARY KEY,
			trace_id TEXT,
			session_id TEXT,
			user_id TEXT,
			name TEXT,
			root_primitive TEXT,
			status TEXT,
			started_at TEXT,
			ended_at TEXT,
			duration_ms REAL,
			span_count INTEGER NOT NULL DEFAULT 0,
			event_count INTEGER NOT NULL DEFAULT 0,
			artifact_count INTEGER NOT NULL DEFAULT 0,
			edge_count INTEGER NOT NULL DEFAULT 0,
			record_count INTEGER NOT NULL DEFAULT 0,
			total_input_tokens INTEGER NOT NULL DEFAULT 0,
			total_output_tokens INTEGER NOT NULL DEFAULT 0,
			total_cost_usd REAL NOT NULL DEFAULT 0,
			last_activity_at TEXT,
			lifecycle_status TEXT,
			lifecycle_checked_at TEXT,
			attributes_json TEXT,
			metrics_json TEXT,
			error_json TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_runs_trace_id ON runs(trace_id)`,
		`CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC, run_id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`,
		`CREATE INDEX IF NOT EXISTS idx_runs_root_primitive ON runs(root_primitive)`,
		`CREATE TABLE IF NOT EXISTS spans (
			span_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			parent_span_id TEXT,
			family TEXT,
			primitive TEXT,
			name TEXT,
			status TEXT,
			started_at TEXT,
			ended_at TEXT,
			duration_ms REAL,
			model TEXT,
			provider TEXT,
			prompt_id TEXT,
			context_id TEXT,
			agent_id TEXT,
			tool_name TEXT,
			flow_id TEXT,
			step_id TEXT,
			memory_id TEXT,
			retriever_id TEXT,
			attributes_json TEXT,
			metrics_json TEXT,
			error_json TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_run_id ON spans(run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_run_started ON spans(run_id, started_at, span_id)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_run_parent ON spans(run_id, parent_span_id)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_run_family ON spans(run_id, family)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_run_primitive ON spans(run_id, primitive)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_status ON spans(status)`,
		`CREATE INDEX IF NOT EXISTS idx_spans_family_started ON spans(family, started_at)`,
		`CREATE TABLE IF NOT EXISTS span_events (
			event_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			span_id TEXT NOT NULL,
			name TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			attributes_json TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_span_events_run_id ON span_events(run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_span_events_run_span_time ON span_events(run_id, span_id, timestamp, event_id)`,
		`CREATE INDEX IF NOT EXISTS idx_span_events_run_time ON span_events(run_id, timestamp, event_id)`,
		`CREATE INDEX IF NOT EXISTS idx_span_events_usage ON span_events(name, run_id)`,
		`CREATE TABLE IF NOT EXISTS artifacts (
			artifact_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			span_id TEXT,
			kind TEXT NOT NULL,
			created_at TEXT NOT NULL,
			content_type TEXT NOT NULL,
			encoding TEXT NOT NULL,
			size_bytes INTEGER,
			hash TEXT,
			preview_json TEXT,
			uri TEXT,
			attributes_json TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_artifacts_run_created ON artifacts(run_id, created_at, artifact_id)`,
		`CREATE INDEX IF NOT EXISTS idx_artifacts_run_span_kind ON artifacts(run_id, span_id, kind)`,
		`CREATE INDEX IF NOT EXISTS idx_artifacts_span ON artifacts(span_id)`,
		`CREATE TABLE IF NOT EXISTS edges (
			edge_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			edge_type TEXT NOT NULL,
			from_kind TEXT NOT NULL,
			from_id TEXT NOT NULL,
			to_kind TEXT NOT NULL,
			to_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			attributes_json TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_edges_run_id ON edges(run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_edges_run_created ON edges(run_id, created_at, edge_id)`,
		`CREATE INDEX IF NOT EXISTS idx_edges_run_from ON edges(run_id, from_kind, from_id)`,
		`CREATE INDEX IF NOT EXISTS idx_edges_run_to ON edges(run_id, to_kind, to_id)`,
		`CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id)`,
		`CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("execute migration statement: %w", err)
		}
	}
	if err := ensureColumn(ctx, s.db, "records", "seq", `ALTER TABLE records ADD COLUMN seq INTEGER NOT NULL DEFAULT 0`); err != nil {
		return err
	}
	if err := ensureColumn(ctx, s.db, "runs", "session_id", `ALTER TABLE runs ADD COLUMN session_id TEXT`); err != nil {
		return err
	}
	if err := ensureColumn(ctx, s.db, "runs", "user_id", `ALTER TABLE runs ADD COLUMN user_id TEXT`); err != nil {
		return err
	}
	for _, column := range []struct {
		name string
		ddl  string
	}{
		{name: "span_count", ddl: `ALTER TABLE runs ADD COLUMN span_count INTEGER NOT NULL DEFAULT 0`},
		{name: "event_count", ddl: `ALTER TABLE runs ADD COLUMN event_count INTEGER NOT NULL DEFAULT 0`},
		{name: "artifact_count", ddl: `ALTER TABLE runs ADD COLUMN artifact_count INTEGER NOT NULL DEFAULT 0`},
		{name: "edge_count", ddl: `ALTER TABLE runs ADD COLUMN edge_count INTEGER NOT NULL DEFAULT 0`},
		{name: "record_count", ddl: `ALTER TABLE runs ADD COLUMN record_count INTEGER NOT NULL DEFAULT 0`},
		{name: "total_input_tokens", ddl: `ALTER TABLE runs ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0`},
		{name: "total_output_tokens", ddl: `ALTER TABLE runs ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0`},
		{name: "total_cost_usd", ddl: `ALTER TABLE runs ADD COLUMN total_cost_usd REAL NOT NULL DEFAULT 0`},
		{name: "last_activity_at", ddl: `ALTER TABLE runs ADD COLUMN last_activity_at TEXT`},
		{name: "lifecycle_status", ddl: `ALTER TABLE runs ADD COLUMN lifecycle_status TEXT`},
		{name: "lifecycle_checked_at", ddl: `ALTER TABLE runs ADD COLUMN lifecycle_checked_at TEXT`},
	} {
		if err := ensureColumn(ctx, s.db, "runs", column.name, column.ddl); err != nil {
			return err
		}
	}
	if _, err := s.db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_records_run_seq ON records(run_id, seq, received_at, record_id)`); err != nil {
		return fmt.Errorf("create records sequence index: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, started_at DESC)`); err != nil {
		return fmt.Errorf("create runs session index: %w", err)
	}
	for _, index := range []struct {
		name string
		ddl  string
	}{
		{name: "idx_spans_status", ddl: `CREATE INDEX IF NOT EXISTS idx_spans_status ON spans(status)`},
		{name: "idx_spans_family_started", ddl: `CREATE INDEX IF NOT EXISTS idx_spans_family_started ON spans(family, started_at)`},
		{name: "idx_artifacts_span", ddl: `CREATE INDEX IF NOT EXISTS idx_artifacts_span ON artifacts(span_id)`},
		{name: "idx_edges_from", ddl: `CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id)`},
		{name: "idx_edges_to", ddl: `CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id)`},
	} {
		if _, err := s.db.ExecContext(ctx, index.ddl); err != nil {
			return fmt.Errorf("create %s index: %w", index.name, err)
		}
	}
	return nil
}

func ensureColumn(ctx context.Context, db *sql.DB, table string, column string, ddl string) error {
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return fmt.Errorf("inspect columns for %s: %w", table, err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return fmt.Errorf("scan column info for %s: %w", table, err)
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate columns for %s: %w", table, err)
	}
	if _, err := db.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("add %s.%s column: %w", table, column, err)
	}
	return nil
}

func deleteRunRows(ctx context.Context, tx *sql.Tx, runIDs []string) error {
	placeholders := strings.TrimRight(strings.Repeat("?,", len(runIDs)), ",")
	args := make([]any, len(runIDs))
	for i, runID := range runIDs {
		args[i] = runID
	}
	tables := []string{"records", "span_events", "artifacts", "edges", "spans", "runs"}
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
	result, err := statements.exec(ctx, `
		INSERT INTO records (record_id, run_id, trace_id, seq, type, payload_json)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(record_id) DO NOTHING
	`, record.RecordID, record.RunID, nullIfEmpty(record.TraceID), record.Seq, record.Type, string(record.Payload))
	if err != nil {
		return false, err
	}
	inserted, err := rowsAffected(result)
	if err != nil {
		return false, err
	}
	if inserted {
		return true, nil
	}
	if _, err := statements.exec(ctx, `
		UPDATE records
		SET
			run_id = ?,
			trace_id = ?,
			seq = ?,
			type = ?,
			payload_json = ?
		WHERE record_id = ?
	`, record.RunID, nullIfEmpty(record.TraceID), record.Seq, record.Type, string(record.Payload), record.RecordID); err != nil {
		return false, err
	}
	return false, nil
}

func (s *Service) ingestRecord(ctx context.Context, tx *sql.Tx, statements *ingestStatements, record Record) error {
	storedInserted, err := upsertStoredRecord(ctx, statements, record)
	if err != nil {
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
			status = excluded.status,
			ended_at = excluded.ended_at,
			duration_ms = excluded.duration_ms,
			metrics_json = coalesce(excluded.metrics_json, runs.metrics_json),
			error_json = coalesce(excluded.error_json, runs.error_json),
				attributes_json = CASE
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
