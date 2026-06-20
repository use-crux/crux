package devtools

import (
	"context"
	"database/sql"
	"fmt"
)

func migrateProjectIndexFactStore(ctx context.Context, db *sql.DB) error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS index_snapshot_state (
			root TEXT PRIMARY KEY,
			schema_version INTEGER NOT NULL DEFAULT 0,
			project_json TEXT,
			indexed_at TEXT,
			indexing_json TEXT,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS index_phase_state (
			root TEXT NOT NULL,
			phase TEXT NOT NULL,
			patch_json TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (root, phase)
		)`,
		`CREATE TABLE IF NOT EXISTS index_facts (
			root TEXT NOT NULL,
			phase TEXT NOT NULL,
			fact_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			source_file TEXT,
			producer_name TEXT NOT NULL,
			producer_version TEXT NOT NULL,
			fidelity TEXT NOT NULL,
			provenance_json TEXT NOT NULL,
			invalidation_key TEXT,
			sequence INTEGER NOT NULL,
			fact_json TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (root, phase, fact_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_index_facts_kind ON index_facts(root, kind)`,
		`CREATE INDEX IF NOT EXISTS idx_index_facts_source ON index_facts(root, source_file)`,
		`CREATE INDEX IF NOT EXISTS idx_index_facts_producer_phase ON index_facts(root, producer_name, phase)`,
		`CREATE INDEX IF NOT EXISTS idx_index_facts_invalidation ON index_facts(root, invalidation_key)`,
		`CREATE TABLE IF NOT EXISTS index_fact_source_files (
			root TEXT NOT NULL,
			phase TEXT NOT NULL,
			fact_id TEXT NOT NULL,
			source_file TEXT NOT NULL,
			PRIMARY KEY (root, phase, fact_id, source_file)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_index_fact_source_files_file ON index_fact_source_files(root, source_file)`,
		`CREATE TABLE IF NOT EXISTS index_fact_definition_ids (
			root TEXT NOT NULL,
			phase TEXT NOT NULL,
			fact_id TEXT NOT NULL,
			definition_id TEXT NOT NULL,
			PRIMARY KEY (root, phase, fact_id, definition_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_index_fact_definition_ids_id ON index_fact_definition_ids(root, definition_id)`,
		`CREATE TABLE IF NOT EXISTS index_fact_relation_ids (
			root TEXT NOT NULL,
			phase TEXT NOT NULL,
			fact_id TEXT NOT NULL,
			relation_id TEXT NOT NULL,
			PRIMARY KEY (root, phase, fact_id, relation_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_index_fact_relation_ids_id ON index_fact_relation_ids(root, relation_id)`,
	}
	for _, statement := range statements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("execute project index fact store migration: %w", err)
		}
	}
	if err := migrateProjectIndexFactEnvelopeMetadata(ctx, db); err != nil {
		return err
	}
	return nil
}

func migrateProjectIndexFactEnvelopeMetadata(ctx context.Context, db *sql.DB) error {
	columns, err := projectIndexFactColumns(ctx, db)
	if err != nil {
		return err
	}
	missingFidelity := !columns["fidelity"]
	missingProvenance := !columns["provenance_json"]
	if !missingFidelity && !missingProvenance {
		return nil
	}
	for _, table := range []string{"index_fact_source_files", "index_fact_definition_ids", "index_fact_relation_ids", "index_facts", "index_phase_state", "index_snapshot_state"} {
		if _, err := db.ExecContext(ctx, "DELETE FROM "+table); err != nil {
			return fmt.Errorf("clear project index fact cache for envelope metadata migration (%s): %w", table, err)
		}
	}
	if missingFidelity {
		if _, err := db.ExecContext(ctx, `ALTER TABLE index_facts ADD COLUMN fidelity TEXT`); err != nil {
			return fmt.Errorf("add project index fact fidelity column: %w", err)
		}
	}
	if missingProvenance {
		if _, err := db.ExecContext(ctx, `ALTER TABLE index_facts ADD COLUMN provenance_json TEXT`); err != nil {
			return fmt.Errorf("add project index fact provenance column: %w", err)
		}
	}
	return nil
}

func projectIndexFactColumns(ctx context.Context, db *sql.DB) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(index_facts)`)
	if err != nil {
		return nil, fmt.Errorf("inspect project index fact columns: %w", err)
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, fmt.Errorf("scan project index fact column: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inspect project index fact columns: %w", err)
	}
	return columns, nil
}
