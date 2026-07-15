package cache

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// DefinitionEvidence returns durable compiler facts linked to one definition.
// Results are ordered by phase and fact identity for deterministic explanation.
func (s *SQLiteIndexFactStore) DefinitionEvidence(ctx context.Context, root, definitionID string) ([]IndexFactEnvelope, error) {
	if definitionID == "" {
		return []IndexFactEnvelope{}, nil
	}
	if _, err := os.Stat(projectIndexFactStoreDBFile(root)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []IndexFactEnvelope{}, nil
		}
		return nil, fmt.Errorf("stat project index fact store: %w", err)
	}
	db, err := openProjectIndexFactDB(root)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err := migrateProjectIndexFactStore(ctx, db); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `
		SELECT facts.phase, facts.fact_id, facts.kind,
			facts.producer_name, facts.producer_version, facts.fidelity,
			facts.provenance_json, facts.fact_json
		FROM index_fact_definition_ids AS links
		JOIN index_facts AS facts
			ON facts.root = links.root
			AND facts.phase = links.phase
			AND facts.fact_id = links.fact_id
		WHERE links.root = ? AND links.definition_id = ?
		ORDER BY CASE facts.phase
			WHEN 'ast' THEN 0
			WHEN 'semantic' THEN 1
			WHEN 'runtime' THEN 2
			WHEN 'quality' THEN 3
			WHEN 'cache' THEN 4
			ELSE 5
		END, facts.fact_id
	`, root, definitionID)
	if err != nil {
		return nil, fmt.Errorf("query definition evidence: %w", err)
	}
	defer rows.Close()
	return scanDefinitionEvidence(rows, root)
}

func scanDefinitionEvidence(rows *sql.Rows, root string) ([]IndexFactEnvelope, error) {
	evidence := make([]IndexFactEnvelope, 0)
	for rows.Next() {
		var envelope IndexFactEnvelope
		var phase, provenanceJSON, factJSON string
		if err := rows.Scan(
			&phase, &envelope.FactID, &envelope.Kind,
			&envelope.Producer.Name, &envelope.Producer.Version, &envelope.Fidelity,
			&provenanceJSON, &factJSON,
		); err != nil {
			return nil, fmt.Errorf("scan definition evidence: %w", err)
		}
		if err := json.Unmarshal([]byte(provenanceJSON), &envelope.Provenance); err != nil {
			return nil, fmt.Errorf("decode definition evidence provenance %q: %w", envelope.FactID, err)
		}
		envelope.SchemaVersion = 1
		envelope.Phase = IndexPatchPhase(phase)
		envelope.ProjectRoot = root
		envelope.Fact = json.RawMessage(factJSON)
		evidence = append(evidence, envelope)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate definition evidence: %w", err)
	}
	return evidence, nil
}
