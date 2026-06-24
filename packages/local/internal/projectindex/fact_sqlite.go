package projectindex

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

func (s *SQLiteIndexFactStore) CommitPhase(ctx context.Context, tx IndexFactTransaction) error {
	root := tx.Patch.Project.Root
	if root == "" && len(tx.Facts) > 0 {
		root = tx.Facts[0].ProjectRoot
	}
	db, err := openProjectIndexFactDB(root)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := migrateProjectIndexFactStore(ctx, db); err != nil {
		return err
	}
	sqlTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin project index fact transaction: %w", err)
	}
	defer sqlTx.Rollback()

	if err := deleteInvalidatedFacts(ctx, sqlTx, root, tx.Patch.Invalidates); err != nil {
		return err
	}
	if err := upsertProjectIndexSnapshotState(ctx, sqlTx, tx.Patch); err != nil {
		return err
	}
	if err := upsertProjectIndexPhaseState(ctx, sqlTx, tx.Patch); err != nil {
		return err
	}
	for sequence, envelope := range tx.Facts {
		if err := upsertProjectIndexFact(ctx, sqlTx, envelope, sequence); err != nil {
			return err
		}
	}
	if err := sqlTx.Commit(); err != nil {
		return fmt.Errorf("commit project index fact transaction: %w", err)
	}
	return nil
}

func upsertProjectIndexSnapshotState(ctx context.Context, tx *sql.Tx, patch IndexPatch) error {
	projectJSON, err := json.Marshal(patch.Project)
	if err != nil {
		return fmt.Errorf("marshal project index project identity: %w", err)
	}
	var indexingJSON any
	if patch.Indexing != nil {
		data, err := json.Marshal(patch.Indexing)
		if err != nil {
			return fmt.Errorf("marshal project index indexing status: %w", err)
		}
		indexingJSON = string(data)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO index_snapshot_state (root, schema_version, project_json, indexed_at, indexing_json)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(root) DO UPDATE SET
			schema_version = CASE WHEN excluded.schema_version != 0 THEN excluded.schema_version ELSE index_snapshot_state.schema_version END,
			project_json = CASE WHEN excluded.project_json != '{}' THEN excluded.project_json ELSE index_snapshot_state.project_json END,
			indexed_at = CASE WHEN excluded.indexed_at != '' THEN excluded.indexed_at ELSE index_snapshot_state.indexed_at END,
			indexing_json = COALESCE(excluded.indexing_json, index_snapshot_state.indexing_json),
			updated_at = CURRENT_TIMESTAMP
	`, patch.Project.Root, patch.SchemaVersion, string(projectJSON), patch.FinishedAt, indexingJSON); err != nil {
		return fmt.Errorf("upsert project index snapshot state: %w", err)
	}
	return nil
}

func upsertProjectIndexPhaseState(ctx context.Context, tx *sql.Tx, patch IndexPatch) error {
	patch.Facts = IndexPatchFacts{}
	patch.FactEnvelopes = nil
	patch.SemanticSourceProfile = nil
	data, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("marshal project index phase state: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO index_phase_state (root, phase, patch_json)
		VALUES (?, ?, ?)
		ON CONFLICT(root, phase) DO UPDATE SET
			patch_json = excluded.patch_json,
			updated_at = CURRENT_TIMESTAMP
	`, patch.Project.Root, string(patch.Phase), string(data)); err != nil {
		return fmt.Errorf("upsert project index phase state: %w", err)
	}
	return nil
}

func upsertProjectIndexFact(ctx context.Context, tx *sql.Tx, envelope IndexFactEnvelope, sequence int) error {
	if err := validateIndexFactFidelity(envelope); err != nil {
		return err
	}
	if err := validateIndexFactProvenance(envelope); err != nil {
		return err
	}
	links, err := indexFactLinksForEnvelope(envelope)
	if err != nil {
		return err
	}
	sourceFile := firstString(links.SourceFiles)
	invalidationKey := indexFactInvalidationKey(links)
	provenanceJSON, err := json.Marshal(envelope.Provenance)
	if err != nil {
		return fmt.Errorf("marshal project index fact provenance %q: %w", envelope.FactID, err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO index_facts (
			root, phase, fact_id, kind, source_file, producer_name, producer_version, fidelity, provenance_json, invalidation_key, sequence, fact_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(root, phase, fact_id) DO UPDATE SET
			kind = excluded.kind,
			source_file = excluded.source_file,
			producer_name = excluded.producer_name,
			producer_version = excluded.producer_version,
			fidelity = excluded.fidelity,
			provenance_json = excluded.provenance_json,
			invalidation_key = excluded.invalidation_key,
			sequence = excluded.sequence,
			fact_json = excluded.fact_json,
			updated_at = CURRENT_TIMESTAMP
	`, envelope.ProjectRoot, string(envelope.Phase), envelope.FactID, envelope.Kind, nullIfEmptyString(sourceFile), envelope.Producer.Name, envelope.Producer.Version, envelope.Fidelity, string(provenanceJSON), nullIfEmptyString(invalidationKey), sequence, string(envelope.Fact)); err != nil {
		return fmt.Errorf("upsert project index fact %q: %w", envelope.FactID, err)
	}
	if err := replaceFactLinks(ctx, tx, envelope, links); err != nil {
		return err
	}
	return nil
}

func replaceFactLinks(ctx context.Context, tx *sql.Tx, envelope IndexFactEnvelope, links indexFactLinks) error {
	if err := deleteFactLinks(ctx, tx, envelope.ProjectRoot, envelope.Phase, envelope.FactID); err != nil {
		return err
	}
	for _, sourceFile := range links.SourceFiles {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO index_fact_source_files (root, phase, fact_id, source_file) VALUES (?, ?, ?, ?)`, envelope.ProjectRoot, string(envelope.Phase), envelope.FactID, sourceFile); err != nil {
			return fmt.Errorf("insert project index source link: %w", err)
		}
	}
	for _, definitionID := range links.DefinitionIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO index_fact_definition_ids (root, phase, fact_id, definition_id) VALUES (?, ?, ?, ?)`, envelope.ProjectRoot, string(envelope.Phase), envelope.FactID, definitionID); err != nil {
			return fmt.Errorf("insert project index definition link: %w", err)
		}
	}
	for _, relationID := range links.RelationIDs {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO index_fact_relation_ids (root, phase, fact_id, relation_id) VALUES (?, ?, ?, ?)`, envelope.ProjectRoot, string(envelope.Phase), envelope.FactID, relationID); err != nil {
			return fmt.Errorf("insert project index relation link: %w", err)
		}
	}
	return nil
}

func deleteInvalidatedFacts(ctx context.Context, tx *sql.Tx, root string, invalidates *IndexPatchInvalidation) error {
	if invalidates == nil {
		return nil
	}
	if invalidates.All {
		for _, table := range []string{"index_fact_source_files", "index_fact_definition_ids", "index_fact_relation_ids", "index_facts", "index_phase_state", "index_snapshot_state"} {
			if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE root = ?", root); err != nil {
				return fmt.Errorf("clear project index fact table %s: %w", table, err)
			}
		}
		return nil
	}

	keys, definitionIDs, err := factKeysAndDefinitionsForSources(ctx, tx, root, invalidates.Files)
	if err != nil {
		return err
	}
	for _, id := range invalidates.DefinitionIDs {
		if id != "" {
			definitionIDs[id] = true
		}
	}
	if len(definitionIDs) > 0 {
		definitionKeys, err := factKeysForDefinitionIDs(ctx, tx, root, mapKeys(definitionIDs))
		if err != nil {
			return err
		}
		for key := range definitionKeys {
			keys[key] = true
		}
	}
	relationIDs, err := relationIDsForFactKeys(ctx, tx, root, mapKeys(keys))
	if err != nil {
		return err
	}
	if len(relationIDs) > 0 {
		relationKeys, err := factKeysForRelationIDs(ctx, tx, root, relationIDs)
		if err != nil {
			return err
		}
		for key := range relationKeys {
			keys[key] = true
		}
	}
	for key := range keys {
		if err := deleteFactKey(ctx, tx, root, key); err != nil {
			return err
		}
	}
	return nil
}

func deleteFactKey(ctx context.Context, tx *sql.Tx, root string, key factKey) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM index_facts WHERE root = ? AND phase = ? AND fact_id = ?`, root, key.Phase, key.FactID); err != nil {
		return fmt.Errorf("delete project index fact %s/%s: %w", key.Phase, key.FactID, err)
	}
	return deleteFactLinks(ctx, tx, root, IndexPatchPhase(key.Phase), key.FactID)
}

func deleteFactLinks(ctx context.Context, tx *sql.Tx, root string, phase IndexPatchPhase, factID string) error {
	for _, table := range []string{"index_fact_source_files", "index_fact_definition_ids", "index_fact_relation_ids"} {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE root = ? AND phase = ? AND fact_id = ?", root, string(phase), factID); err != nil {
			return fmt.Errorf("delete project index fact links from %s: %w", table, err)
		}
	}
	return nil
}

func nullIfEmptyString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func indexFactInvalidationKey(links indexFactLinks) string {
	if value := firstString(links.SourceFiles); value != "" {
		return "file:" + value
	}
	if value := firstString(links.DefinitionIDs); value != "" {
		return "definition:" + value
	}
	if value := firstString(links.RelationIDs); value != "" {
		return "relation:" + value
	}
	return ""
}
