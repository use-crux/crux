package observability

import (
	"context"
	"database/sql"
	"fmt"
)

// LatestDefinitionOperationSnapshot identifies the newest captured operation
// for one definition at an authoritative observability read-model revision.
// An empty OperationID means the snapshot contained no matching operation.
type LatestDefinitionOperationSnapshot struct {
	Revision    int64
	OperationID string
}

// LatestOperationForDefinition atomically reads the current observability
// revision and newest captured operation that references definitionID.
func (s *Service) LatestOperationForDefinition(
	ctx context.Context,
	definitionID string,
) (snapshot LatestDefinitionOperationSnapshot, err error) {
	return s.latestOperationForDefinitionAtSnapshot(ctx, definitionID, nil)
}

func (s *Service) latestOperationForDefinitionAtSnapshot(
	ctx context.Context,
	definitionID string,
	afterSnapshot func(),
) (snapshot LatestDefinitionOperationSnapshot, err error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return snapshot, fmt.Errorf("begin latest definition operation snapshot: %w", err)
	}
	defer func() {
		if rollbackErr := tx.Rollback(); rollbackErr != nil &&
			rollbackErr != sql.ErrTxDone &&
			err == nil {
			err = fmt.Errorf("rollback latest definition operation snapshot: %w", rollbackErr)
		}
	}()

	if err := tx.QueryRowContext(
		ctx,
		`SELECT value FROM observability_revision WHERE id = 1`,
	).Scan(&snapshot.Revision); err != nil {
		return snapshot, fmt.Errorf("read latest definition operation revision: %w", err)
	}
	if afterSnapshot != nil {
		afterSnapshot()
	}

	queryErr := tx.QueryRowContext(ctx, `
		SELECT operations.operation_id
		FROM operations
		WHERE EXISTS (
			SELECT 1
			FROM runs
			JOIN run_definition_activity
				ON run_definition_activity.run_id = runs.run_id
			WHERE runs.operation_id = operations.operation_id
				AND run_definition_activity.definition_id = ?
		)
		ORDER BY
			operations.first_seen_at COLLATE BINARY DESC,
			operations.operation_id COLLATE BINARY DESC
		LIMIT 1
	`, definitionID).Scan(&snapshot.OperationID)
	if queryErr != nil && queryErr != sql.ErrNoRows {
		return snapshot, fmt.Errorf("read latest definition operation candidate: %w", queryErr)
	}
	if err := tx.Commit(); err != nil {
		return snapshot, fmt.Errorf("commit latest definition operation snapshot: %w", err)
	}
	return snapshot, nil
}
