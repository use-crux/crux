package cache

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *SQLiteIndexFactStore) ProjectSnapshot(ctx context.Context, root, projectName string) (store.IndexData, bool, error) {
	if _, err := os.Stat(projectIndexFactStoreDBFile(root)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return store.IndexData{}, false, nil
		}
		return store.IndexData{}, false, fmt.Errorf("stat project index fact store: %w", err)
	}
	db, err := openProjectIndexFactDB(root)
	if err != nil {
		return store.IndexData{}, false, err
	}
	defer db.Close()
	if err := migrateProjectIndexFactStore(ctx, db); err != nil {
		return store.IndexData{}, false, err
	}
	meta, ok, err := loadProjectIndexSnapshotState(ctx, db, root)
	if err != nil || !ok {
		return store.IndexData{}, ok, err
	}
	patches, err := loadProjectIndexPatches(ctx, db, root)
	if err != nil {
		return store.IndexData{}, false, err
	}
	state := EmptyPatchState()
	for _, patch := range patches {
		state = ApplyPatch(state, patch)
	}
	index := state.Index
	applySnapshotState(&index, meta, root, projectName)
	return index, true, nil
}

type projectIndexSnapshotState struct {
	SchemaVersion int
	Project       *store.ProjectIdentity
	IndexedAt     string
	Indexing      *store.ProjectIndexingStatus
}

func loadProjectIndexSnapshotState(ctx context.Context, db *sql.DB, root string) (projectIndexSnapshotState, bool, error) {
	var schemaVersion int
	var projectJSON, indexedAt string
	var indexingJSON sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT schema_version, COALESCE(project_json, ''), COALESCE(indexed_at, ''), indexing_json
		FROM index_snapshot_state
		WHERE root = ?
	`, root).Scan(&schemaVersion, &projectJSON, &indexedAt, &indexingJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return projectIndexSnapshotState{}, false, nil
	}
	if err != nil {
		return projectIndexSnapshotState{}, false, fmt.Errorf("load project index snapshot state: %w", err)
	}
	meta := projectIndexSnapshotState{SchemaVersion: schemaVersion, IndexedAt: indexedAt}
	if projectJSON != "" {
		var project store.ProjectIdentity
		if err := json.Unmarshal([]byte(projectJSON), &project); err != nil {
			return projectIndexSnapshotState{}, false, fmt.Errorf("decode project index project identity: %w", err)
		}
		meta.Project = &project
	}
	if indexingJSON.Valid && indexingJSON.String != "" {
		var indexing store.ProjectIndexingStatus
		if err := json.Unmarshal([]byte(indexingJSON.String), &indexing); err != nil {
			return projectIndexSnapshotState{}, false, fmt.Errorf("decode project index indexing status: %w", err)
		}
		meta.Indexing = &indexing
	}
	return meta, true, nil
}

func loadProjectIndexPatches(ctx context.Context, db *sql.DB, root string) ([]IndexPatch, error) {
	phaseMeta, err := loadProjectIndexPhaseState(ctx, db, root)
	if err != nil {
		return nil, err
	}
	factsByPhase, err := loadProjectIndexFactsByPhase(ctx, db, root)
	if err != nil {
		return nil, err
	}
	patches := make([]IndexPatch, 0, len(phaseOrderForProjection()))
	for _, phase := range phaseOrderForProjection() {
		facts := factsByPhase[phase]
		patch, hasPatch := phaseMeta[phase]
		if !hasPatch && !HasPatchFacts(facts) {
			continue
		}
		if !hasPatch {
			patch = IndexPatch{SchemaVersion: 1, Phase: phase, Project: store.ProjectIdentity{Root: root}, Status: "ok"}
		}
		patch.Facts = facts
		patches = append(patches, patch)
	}
	return patches, nil
}

func HasPatchFacts(facts IndexPatchFacts) bool {
	return len(facts.Prompts) > 0 ||
		len(facts.Contexts) > 0 ||
		len(facts.Tools) > 0 ||
		facts.Lint != nil ||
		len(facts.Definitions) > 0 ||
		len(facts.Relations) > 0 ||
		len(facts.SourceRefs) > 0 ||
		len(facts.Diagnostics) > 0 ||
		len(facts.LintFindings) > 0 ||
		len(facts.RuleDescriptors) > 0 ||
		len(facts.Sources) > 0 ||
		facts.SourceGraph != nil
}

func loadProjectIndexPhaseState(ctx context.Context, db *sql.DB, root string) (map[IndexPatchPhase]IndexPatch, error) {
	rows, err := db.QueryContext(ctx, `SELECT phase, patch_json FROM index_phase_state WHERE root = ?`, root)
	if err != nil {
		return nil, fmt.Errorf("query project index phase state: %w", err)
	}
	defer rows.Close()
	patches := map[IndexPatchPhase]IndexPatch{}
	for rows.Next() {
		var phase string
		var patchJSON string
		if err := rows.Scan(&phase, &patchJSON); err != nil {
			return nil, err
		}
		var patch IndexPatch
		if err := json.Unmarshal([]byte(patchJSON), &patch); err != nil {
			return nil, fmt.Errorf("decode project index phase %s: %w", phase, err)
		}
		patches[IndexPatchPhase(phase)] = patch
	}
	return patches, rows.Err()
}

func loadProjectIndexFactsByPhase(ctx context.Context, db *sql.DB, root string) (map[IndexPatchPhase]IndexPatchFacts, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT phase, fact_id, kind, producer_name, producer_version, fidelity, provenance_json, fact_json
		FROM index_facts
		WHERE root = ?
		ORDER BY CASE phase
			WHEN 'cache' THEN 0
			WHEN 'ast' THEN 1
			WHEN 'semantic' THEN 2
			WHEN 'runtime' THEN 3
			WHEN 'quality' THEN 4
			ELSE 5
		END, sequence, fact_id
	`, root)
	if err != nil {
		return nil, fmt.Errorf("query project index facts: %w", err)
	}
	defer rows.Close()

	envelopes := map[IndexPatchPhase][]IndexFactEnvelope{}
	for rows.Next() {
		var envelope IndexFactEnvelope
		var phase string
		var producer IndexFactProducer
		var provenanceJSON string
		var factJSON string
		if err := rows.Scan(&phase, &envelope.FactID, &envelope.Kind, &producer.Name, &producer.Version, &envelope.Fidelity, &provenanceJSON, &factJSON); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(provenanceJSON), &envelope.Provenance); err != nil {
			return nil, fmt.Errorf("decode project index fact provenance %q: %w", envelope.FactID, err)
		}
		envelope.SchemaVersion = 1
		envelope.Phase = IndexPatchPhase(phase)
		envelope.ProjectRoot = root
		envelope.Producer = producer
		envelope.Fact = json.RawMessage(factJSON)
		envelopes[envelope.Phase] = append(envelopes[envelope.Phase], envelope)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	factsByPhase := map[IndexPatchPhase]IndexPatchFacts{}
	for phase, facts := range envelopes {
		decoded, err := indexPatchFactsFromEnvelopes(facts)
		if err != nil {
			return nil, err
		}
		factsByPhase[phase] = decoded
	}
	return factsByPhase, nil
}

func applySnapshotState(index *store.IndexData, meta projectIndexSnapshotState, root, projectName string) {
	if meta.SchemaVersion != 0 {
		index.SchemaVersion = meta.SchemaVersion
	}
	if meta.Project != nil {
		index.Project = meta.Project
	} else {
		index.Project = &store.ProjectIdentity{Root: root}
	}
	if index.Project.Name == "" {
		index.Project.Name = projectName
	}
	if meta.IndexedAt != "" {
		index.IndexedAt = meta.IndexedAt
	}
	if meta.Indexing != nil {
		index.Indexing = meta.Indexing
	}
}

func phaseOrderForProjection() []IndexPatchPhase {
	return []IndexPatchPhase{PhaseCache, PhaseAST, PhaseSemantic, PhaseRuntime, PhaseQuality}
}
