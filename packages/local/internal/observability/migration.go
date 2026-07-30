package observability

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type observabilityMigrationHook func(step string) error

type sqliteRunner interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (s *Service) migrate(ctx context.Context) error {
	return s.migrateWithHook(ctx, nil)
}

func (s *Service) migrateWithHook(ctx context.Context, hook observabilityMigrationHook) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin observability schema migration: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	needsReset, err := needsCurrentObservabilityReset(ctx, tx)
	if err != nil {
		return err
	}
	if needsReset {
		if err := dropObservabilityTables(ctx, tx); err != nil {
			return err
		}
		if hook != nil {
			if err := hook("after-contract-reset"); err != nil {
				return err
			}
		}
	}
	if err := createObservabilitySchema(ctx, tx); err != nil {
		return err
	}
	if err := ensureEvidenceSupersessionState(ctx, tx); err != nil {
		return err
	}
	now := time.Now().UTC()
	if s.evidenceNow != nil {
		now = s.evidenceNow().UTC()
	}
	converted, err := migrateLegacyApprovalArtifactPrivacyState(
		ctx,
		tx,
		formatEvidenceAcceptanceTime(now),
	)
	if err != nil {
		return err
	}
	if hook != nil {
		if err := hook("after-approval-privacy-migration"); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit observability schema migration: %w", err)
	}
	committed = true
	s.approvalMigrationConverted = converted
	return nil
}

func observabilitySchemaStatements() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS records (
			record_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			operation_id TEXT NOT NULL,
			trace_id TEXT,
			segment_id TEXT NOT NULL,
			segment_seq INTEGER NOT NULL,
			type TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_records_segment_seq_unique ON records(segment_id, segment_seq)`,
		`CREATE INDEX IF NOT EXISTS idx_records_run_id ON records(run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_records_operation_id ON records(operation_id)`,
		`CREATE INDEX IF NOT EXISTS idx_records_run_received ON records(run_id, received_at, record_id)`,
		`CREATE TABLE IF NOT EXISTS runs (
			run_id TEXT PRIMARY KEY,
			operation_id TEXT NOT NULL,
			parent_run_id TEXT,
			triggered_by_span_id TEXT,
			trace_id TEXT,
			project_id TEXT,
			manifest_id TEXT,
			deployment_id TEXT,
			deployment_observed INTEGER NOT NULL DEFAULT 0,
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
		`CREATE INDEX IF NOT EXISTS idx_runs_operation_id ON runs(operation_id, run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_runs_parent_run_id ON runs(parent_run_id)`,
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
		`CREATE TABLE IF NOT EXISTS run_segments (
			segment_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			status TEXT,
			started_at TEXT,
			resumed_at TEXT,
			suspended_at TEXT,
			ended_at TEXT,
			reason TEXT,
			previous_segment_id TEXT,
			first_segment_seq INTEGER NOT NULL DEFAULT 0,
			last_segment_seq INTEGER NOT NULL DEFAULT 0,
			gap_count INTEGER NOT NULL DEFAULT 0,
			conflict_count INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_run_segments_run ON run_segments(run_id, segment_id)`,
		`CREATE TABLE IF NOT EXISTS ingest_health (
			code TEXT NOT NULL,
			record_id TEXT NOT NULL,
			run_id TEXT,
			occurrence_count INTEGER NOT NULL DEFAULT 1,
			message TEXT NOT NULL,
			first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (code, record_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ingest_health_run ON ingest_health(run_id, last_seen_at DESC)`,
		`CREATE TABLE IF NOT EXISTS observability_source_health (
			source_id TEXT PRIMARY KEY,
			accepted INTEGER NOT NULL DEFAULT 0,
			retried INTEGER NOT NULL DEFAULT 0,
			permanently_rejected INTEGER NOT NULL DEFAULT 0,
			overflow_dropped INTEGER NOT NULL DEFAULT 0,
			deadline_dropped INTEGER NOT NULL DEFAULT 0,
			last_error_code TEXT,
			last_error_message TEXT,
			last_error_evidence_ids_json TEXT,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		// observability_revision is a single-row monotonic counter. Every run
		// touched by a committed ingest transaction is assigned the next value,
		// so the Runs read model can report a response-level revision and
		// clients can detect which rows changed since a prior read.
		`CREATE TABLE IF NOT EXISTS observability_revision (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			value INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS operations (
			operation_id TEXT PRIMARY KEY,
			first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			root_present INTEGER NOT NULL DEFAULT 0,
			revision INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_operations_first_seen ON operations(first_seen_at DESC, operation_id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_operations_revision ON operations(revision)`,
		`CREATE TABLE IF NOT EXISTS operation_tombstones (
			operation_id TEXT PRIMARY KEY,
			deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		// observability_run_revision_log is a bounded change log used for
		// server-owned delta/catch-up: reconnect clients present the last
		// revision they applied and get back only the runs touched since,
		// or an explicit expired signal once the log has been pruned past
		// their watermark.
		`CREATE TABLE IF NOT EXISTS observability_run_revision_log (
			revision INTEGER PRIMARY KEY,
			operation_id TEXT NOT NULL,
			changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_run_revision_log_operation ON observability_run_revision_log(operation_id)`,
		// run_definition_activity is a DERIVED projection of the runtime↔Project
		// Index join: for each run, which authored definitions its records
		// referenced (via DefinitionRef), in what role(s), how often, and when it
		// was first/last seen. A definition legitimately shows up under more than
		// one role within a run (e.g. resolved as a prompt and separately invoked
		// as a tool), so the key is (run_id, definition_id, role) — one row per
		// distinct role, never collapsed. It is rebuildable at any time by
		// replaying the immutable `records` rows (see RebuildDefinitionActivity),
		// so it holds NO revision, fingerprint, or identity column of its own —
		// it is addressed only through the run_id it derives from, reuses
		// observability_revision for change tracking (a definition's activity
		// only changes as a side effect of ingesting a record that already bumps
		// its run's revision), and follows the parent run's retention/deletion
		// exactly. It never persists a denormalized Project Index copy: only the
		// runtime-emitted id/kind/role, resolved against the current snapshot at
		// read time by consumers.
		`CREATE TABLE IF NOT EXISTS run_definition_activity (
			run_id TEXT NOT NULL,
			definition_id TEXT NOT NULL,
			definition_kind TEXT NOT NULL,
			role TEXT NOT NULL,
			first_seen_at TEXT NOT NULL,
			last_seen_at TEXT NOT NULL,
			occurrence_count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (run_id, definition_id, role)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_run_definition_activity_definition ON run_definition_activity(definition_id)`,
	}
}

func createObservabilitySchema(ctx context.Context, runner sqliteRunner) error {
	if err := rebuildProvisionalEvidenceStagingSchema(ctx, runner); err != nil {
		return err
	}
	if err := rebuildProvisionalApprovalArtifactSchema(ctx, runner); err != nil {
		return err
	}
	statements := append(observabilitySchemaStatements(), evidenceSchemaStatements()...)
	for _, statement := range statements {
		if _, err := runner.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("execute migration statement: %w", err)
		}
	}
	if err := ensureColumn(ctx, runner, "runs", "session_id", `ALTER TABLE runs ADD COLUMN session_id TEXT`); err != nil {
		return err
	}
	if err := ensureColumn(ctx, runner, "runs", "user_id", `ALTER TABLE runs ADD COLUMN user_id TEXT`); err != nil {
		return err
	}
	for _, column := range []struct{ name, ddl string }{
		{name: "resumed_at", ddl: `ALTER TABLE run_segments ADD COLUMN resumed_at TEXT`},
		{name: "suspended_at", ddl: `ALTER TABLE run_segments ADD COLUMN suspended_at TEXT`},
		{name: "reason", ddl: `ALTER TABLE run_segments ADD COLUMN reason TEXT`},
		{name: "previous_segment_id", ddl: `ALTER TABLE run_segments ADD COLUMN previous_segment_id TEXT`},
		{name: "gap_count", ddl: `ALTER TABLE run_segments ADD COLUMN gap_count INTEGER NOT NULL DEFAULT 0`},
		{name: "conflict_count", ddl: `ALTER TABLE run_segments ADD COLUMN conflict_count INTEGER NOT NULL DEFAULT 0`},
	} {
		if err := ensureColumn(ctx, runner, "run_segments", column.name, column.ddl); err != nil {
			return err
		}
	}
	for _, column := range []struct {
		name string
		ddl  string
	}{
		{name: "project_id", ddl: `ALTER TABLE runs ADD COLUMN project_id TEXT`},
		{name: "manifest_id", ddl: `ALTER TABLE runs ADD COLUMN manifest_id TEXT`},
		{name: "deployment_id", ddl: `ALTER TABLE runs ADD COLUMN deployment_id TEXT`},
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
		{name: "revision", ddl: `ALTER TABLE runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`},
	} {
		if err := ensureColumn(ctx, runner, "runs", column.name, column.ddl); err != nil {
			return err
		}
	}
	if err := ensureColumn(
		ctx,
		runner,
		"observability_source_health",
		"last_error_evidence_ids_json",
		`ALTER TABLE observability_source_health ADD COLUMN last_error_evidence_ids_json TEXT`,
	); err != nil {
		return err
	}
	if err := ensureColumn(
		ctx,
		runner,
		"evidence_reservations",
		"digest_verification_state",
		`ALTER TABLE evidence_reservations
		 ADD COLUMN digest_verification_state TEXT NOT NULL DEFAULT 'not-required'`,
	); err != nil {
		return err
	}
	if _, err := runner.ExecContext(ctx, `
		UPDATE evidence_reservations
		SET digest_verification_state = CASE
			WHEN content_digest IS NULL THEN 'not-required'
			WHEN source_mode = 'reference' THEN 'verified'
			WHEN EXISTS (
				SELECT 1 FROM evidence_relationships relationships
				WHERE relationships.authorization_namespace =
					evidence_reservations.authorization_namespace
				  AND relationships.evidence_id =
					evidence_reservations.evidence_id
				  AND relationships.original_capture_state IN (
					'redacted', 'not-captured'
				  )
			) THEN 'verified'
			ELSE 'pending'
		END
	`); err != nil {
		return fmt.Errorf(
			"backfill evidence digest verification state: %w",
			err,
		)
	}
	if _, err := runner.ExecContext(ctx, `
		DELETE FROM evidence_staging_candidates
		WHERE digest_version <> ?
	`, evidenceCandidateDigestVersion); err != nil {
		return fmt.Errorf(
			"purge incompatible evidence staging candidates: %w",
			err,
		)
	}
	if _, err := runner.ExecContext(ctx, `INSERT OR IGNORE INTO observability_revision (id, value) VALUES (1, 0)`); err != nil {
		return fmt.Errorf("seed observability revision counter: %w", err)
	}
	if _, err := runner.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_runs_revision ON runs(revision)`); err != nil {
		return fmt.Errorf("create runs revision index: %w", err)
	}
	if _, err := runner.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_records_run_segment_seq ON records(run_id, segment_id, segment_seq, received_at, record_id)`); err != nil {
		return fmt.Errorf("create records segment sequence index: %w", err)
	}
	if _, err := runner.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS idx_records_segment_seq_unique ON records(segment_id, segment_seq)`); err != nil {
		return fmt.Errorf("create records segment sequence uniqueness index: %w", err)
	}
	if _, err := runner.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id, started_at DESC)`); err != nil {
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
		if _, err := runner.ExecContext(ctx, index.ddl); err != nil {
			return fmt.Errorf("create %s index: %w", index.name, err)
		}
	}
	return nil
}

func needsCurrentObservabilityReset(ctx context.Context, runner sqliteRunner) (bool, error) {
	recordsColumns, exists, err := tableColumns(ctx, runner, "records")
	if err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	if !hasExactColumns(recordsColumns, []string{
		"record_id",
		"run_id",
		"operation_id",
		"trace_id",
		"segment_id",
		"segment_seq",
		"type",
		"payload_json",
		"received_at",
	}) {
		return true, nil
	}
	complete, err := uniqueIndexExists(ctx, runner, "records", "idx_records_segment_seq_unique", []string{"segment_id", "segment_seq"})
	if err != nil {
		return false, err
	}
	if !complete {
		return true, nil
	}

	runColumns, runExists, err := tableColumns(ctx, runner, "runs")
	if err != nil {
		return false, err
	}
	if !runExists || !runColumns["operation_id"] || !runColumns["parent_run_id"] || !runColumns["triggered_by_span_id"] || !runColumns["deployment_observed"] {
		return true, nil
	}

	segmentColumns, segmentExists, err := tableColumns(ctx, runner, "run_segments")
	if err != nil {
		return false, err
	}
	if !segmentExists {
		return true, nil
	}
	phase1SegmentColumns := []string{
		"segment_id",
		"run_id",
		"status",
		"started_at",
		"ended_at",
		"first_segment_seq",
		"last_segment_seq",
	}
	phase3SegmentColumns := append(append([]string{}, phase1SegmentColumns...),
		"resumed_at", "suspended_at", "reason", "previous_segment_id", "gap_count", "conflict_count")
	if !hasExactColumns(segmentColumns, phase1SegmentColumns) && !hasExactColumns(segmentColumns, phase3SegmentColumns) {
		return true, nil
	}
	complete, err = tablePrimaryKeyColumns(ctx, runner, "run_segments", []string{"segment_id"})
	if err != nil {
		return false, err
	}
	return !complete, nil
}

func hasExactColumns(actual map[string]bool, expected []string) bool {
	if len(actual) != len(expected) {
		return false
	}
	for _, column := range expected {
		if !actual[column] {
			return false
		}
	}
	return true
}

func dropObservabilityTables(ctx context.Context, runner sqliteRunner) error {
	tables := append(evidenceTableNamesForDeletion(), []string{
		"records",
		"span_events",
		"artifacts",
		"edges",
		"spans",
		"runs",
		"run_segments",
		"ingest_health",
		"observability_source_health",
		"observability_revision",
		"observability_run_revision_log",
		"operations",
		"operation_tombstones",
		"run_definition_activity",
	}...)
	for _, table := range tables {
		if _, err := runner.ExecContext(ctx, "DROP TABLE IF EXISTS "+table); err != nil {
			return fmt.Errorf("reset pre-v2 observability table %s: %w", table, err)
		}
	}
	return nil
}

func tableColumns(ctx context.Context, runner sqliteRunner, table string) (map[string]bool, bool, error) {
	rows, err := runner.QueryContext(ctx, fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return nil, false, fmt.Errorf("inspect columns for %s: %w", table, err)
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return nil, false, err
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	return columns, len(columns) > 0, nil
}

func tablePrimaryKeyColumns(ctx context.Context, runner sqliteRunner, table string, expected []string) (bool, error) {
	rows, err := runner.QueryContext(ctx, fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return false, fmt.Errorf("inspect primary key for %s: %w", table, err)
	}
	defer rows.Close()
	actual := make([]string, len(expected))
	count := 0
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if pk > 0 {
			count++
			if pk <= len(actual) {
				actual[pk-1] = name
			}
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if count != len(expected) {
		return false, nil
	}
	for i := range expected {
		if actual[i] != expected[i] {
			return false, nil
		}
	}
	return true, nil
}

func uniqueIndexExists(ctx context.Context, runner sqliteRunner, table string, indexName string, expectedColumns []string) (bool, error) {
	rows, err := runner.QueryContext(ctx, fmt.Sprintf(`PRAGMA index_list(%s)`, table))
	if err != nil {
		return false, fmt.Errorf("inspect indexes for %s: %w", table, err)
	}
	found := false
	for rows.Next() {
		var seq int
		var name string
		var unique int
		var origin string
		var partial int
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			rows.Close()
			return false, err
		}
		if name == indexName && unique == 1 {
			found = true
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, err
	}
	if err := rows.Close(); err != nil {
		return false, err
	}
	if !found {
		return false, nil
	}

	infoRows, err := runner.QueryContext(ctx, fmt.Sprintf(`PRAGMA index_info(%s)`, indexName))
	if err != nil {
		return false, fmt.Errorf("inspect index %s: %w", indexName, err)
	}
	defer infoRows.Close()
	actual := make([]string, 0, len(expectedColumns))
	for infoRows.Next() {
		var seqno int
		var cid int
		var name string
		if err := infoRows.Scan(&seqno, &cid, &name); err != nil {
			return false, err
		}
		actual = append(actual, name)
	}
	if err := infoRows.Err(); err != nil {
		return false, err
	}
	if len(actual) != len(expectedColumns) {
		return false, nil
	}
	for i := range expectedColumns {
		if actual[i] != expectedColumns[i] {
			return false, nil
		}
	}
	return true, nil
}

func ensureColumn(ctx context.Context, runner sqliteRunner, table string, column string, ddl string) error {
	rows, err := runner.QueryContext(ctx, fmt.Sprintf(`PRAGMA table_info(%s)`, table))
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
	if _, err := runner.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("add %s.%s column: %w", table, column, err)
	}
	return nil
}
