package observability

import (
	"context"
	"encoding/json"
	"fmt"
)

// SanitizedSourceRef is the repo-relative source pointer optionally carried by a
// DefinitionRef. It mirrors the `@use-crux/core` wire shape but is never
// persisted into run_definition_activity: the projection stores only stable
// identity, resolving location against the current Project Index at read time.
type SanitizedSourceRef struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column int    `json:"column,omitempty"`
}

// DefinitionRef is runtime evidence linking a graph record back to the Project
// Index definition it resolved or invoked. It is emitted only when the runtime
// already holds a compiled definition handle, so `ID` equals the corresponding
// store.ProjectDefinition.ID exactly and the Go join is a plain equality lookup.
type DefinitionRef struct {
	ID     string              `json:"id"`
	Kind   string              `json:"kind"`
	Role   string              `json:"role"`
	Source *SanitizedSourceRef `json:"source,omitempty"`
}

// DefinitionActivity is one derived row of the run↔definition projection: which
// definition a run touched, in what role, how many times, and when it was first
// and last seen. It carries no revision/fingerprint of its own — see
// run_definition_activity in migration.go.
type DefinitionActivity struct {
	DefinitionID    string `json:"definitionId"`
	DefinitionKind  string `json:"definitionKind"`
	Role            string `json:"role"`
	FirstSeenAt     string `json:"firstSeenAt"`
	LastSeenAt      string `json:"lastSeenAt"`
	OccurrenceCount int    `json:"occurrenceCount"`
}

// definitionRefsEnvelope decodes just the fields the projection needs from a
// run:start / span:start / span payload: the record's own timestamp and its
// DefinitionRefs. Every other field is ignored so the projection never depends
// on the full record shape.
type definitionRefsEnvelope struct {
	StartedAt      string          `json:"startedAt"`
	DefinitionRefs []DefinitionRef `json:"definitionRefs"`
}

// recordDefinitionRefs extracts the DefinitionRefs and the deterministic
// timestamp (the record's own startedAt) for the record types that carry them.
// The timestamp is payload-derived, not wall-clock, so replay reproduces
// identical first/last-seen values regardless of ingest order or time.
func recordDefinitionRefs(record Record) ([]DefinitionRef, string) {
	switch record.Type {
	case RecordRunStart, RecordSpanStart, RecordSpan:
	default:
		return nil, ""
	}
	var envelope definitionRefsEnvelope
	if err := json.Unmarshal(record.Payload, &envelope); err != nil {
		return nil, ""
	}
	return envelope.DefinitionRefs, envelope.StartedAt
}

// projectDefinitionActivity folds a newly-stored record's DefinitionRefs into
// run_definition_activity inside the caller's ingest transaction. It is called
// only for genuinely-new records (the storedInserted gate in ingestRecord), so
// duplicate records inherit idempotency from the ingest-dedup path and never
// double-count. Refs are deduped by id per record so occurrence_count counts
// records, not repeated refs within one record.
func projectDefinitionActivity(ctx context.Context, statements *ingestStatements, record Record) error {
	refs, startedAt := recordDefinitionRefs(record)
	if len(refs) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if ref.ID == "" {
			continue
		}
		if _, dup := seen[ref.ID]; dup {
			continue
		}
		seen[ref.ID] = struct{}{}
		if err := upsertDefinitionActivity(ctx, statements, record.RunID, startedAt, ref); err != nil {
			return err
		}
	}
	return nil
}

// upsertDefinitionActivity writes or accumulates one (run, definition) row.
// Every mutated column is a commutative/associative aggregate (min/max on the
// text columns, sum on occurrence_count) so the resulting row is independent of
// the order records are applied — the invariant replay relies on.
func upsertDefinitionActivity(ctx context.Context, statements *ingestStatements, runID, startedAt string, ref DefinitionRef) error {
	if runID == "" {
		return nil
	}
	_, err := statements.exec(ctx, `
		INSERT INTO run_definition_activity (
			run_id, definition_id, definition_kind, role, first_seen_at, last_seen_at, occurrence_count
		)
		VALUES (?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(run_id, definition_id) DO UPDATE SET
			definition_kind = min(run_definition_activity.definition_kind, excluded.definition_kind),
			role = min(run_definition_activity.role, excluded.role),
			first_seen_at = min(run_definition_activity.first_seen_at, excluded.first_seen_at),
			last_seen_at = max(run_definition_activity.last_seen_at, excluded.last_seen_at),
			occurrence_count = run_definition_activity.occurrence_count + excluded.occurrence_count
	`, runID, ref.ID, ref.Kind, ref.Role, startedAt, startedAt)
	if err != nil {
		return fmt.Errorf("project run definition activity for %q/%q: %w", runID, ref.ID, err)
	}
	return nil
}

// RunDefinitionActivity returns the definitions a single run touched, ordered by
// definition id. Rows are returned exactly as stored (no Project Index
// resolution); read-time resolution against the current snapshot — including
// reporting a since-deleted definition as unresolved — is a consumer concern.
func (s *Service) RunDefinitionActivity(ctx context.Context, runID string) ([]DefinitionActivity, error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()

	canonicalRunID, err := s.resolveRunID(ctx, runID)
	if err != nil {
		return nil, fmt.Errorf("resolve observability run %q: %w", runID, err)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT definition_id, definition_kind, role, first_seen_at, last_seen_at, occurrence_count
		FROM run_definition_activity
		WHERE run_id = ?
		ORDER BY definition_id
	`, canonicalRunID)
	if err != nil {
		return nil, fmt.Errorf("query run definition activity for %q: %w", runID, err)
	}
	defer rows.Close()

	activity := make([]DefinitionActivity, 0)
	for rows.Next() {
		var row DefinitionActivity
		if err := rows.Scan(&row.DefinitionID, &row.DefinitionKind, &row.Role, &row.FirstSeenAt, &row.LastSeenAt, &row.OccurrenceCount); err != nil {
			return nil, fmt.Errorf("scan run definition activity for %q: %w", runID, err)
		}
		activity = append(activity, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate run definition activity for %q: %w", runID, err)
	}
	return activity, nil
}

// RebuildDefinitionActivity truncates run_definition_activity and reprojects it
// from the immutable stored records, proving the table is a derived projection
// rebuildable from the authoritative source alone. It never bumps a revision:
// the underlying records are unchanged, so no run's revision changes.
func (s *Service) RebuildDefinitionActivity(ctx context.Context) (err error) {
	ctx, cancel := s.mutationContext(ctx)
	defer cancel()

	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin run definition activity rebuild: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			if rollbackErr := tx.Rollback(); rollbackErr != nil && err == nil {
				err = fmt.Errorf("rollback run definition activity rebuild: %w", rollbackErr)
			}
		}
	}()

	if _, err := tx.ExecContext(ctx, `DELETE FROM run_definition_activity`); err != nil {
		return fmt.Errorf("truncate run definition activity: %w", err)
	}

	statements := newIngestStatements(tx)
	defer func() {
		if closeErr := statements.close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()

	rows, err := tx.QueryContext(ctx, `
		SELECT run_id, type, payload_json FROM records ORDER BY run_id, received_at, record_id
	`)
	if err != nil {
		return fmt.Errorf("read stored records for rebuild: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var runID, recordType, payload string
		if err := rows.Scan(&runID, &recordType, &payload); err != nil {
			return fmt.Errorf("scan stored record for rebuild: %w", err)
		}
		record := Record{RunID: runID, Type: RecordType(recordType), Payload: json.RawMessage(payload)}
		if err := projectDefinitionActivity(ctx, statements, record); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate stored records for rebuild: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close stored records for rebuild: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit run definition activity rebuild: %w", err)
	}
	committed = true
	return nil
}
