package observability

import (
	"context"
	"database/sql"
	"fmt"
)

type ingestStatements struct {
	tx                 *sql.Tx
	cache              map[string]*sql.Stmt
	reservedRunRollups map[string]struct{}
	affectedRuns       map[string]struct{}
	affectedSegments   map[string]struct{}
}

func newIngestStatements(tx *sql.Tx) *ingestStatements {
	return &ingestStatements{
		tx:                 tx,
		cache:              make(map[string]*sql.Stmt),
		reservedRunRollups: make(map[string]struct{}),
		affectedRuns:       make(map[string]struct{}),
		affectedSegments:   make(map[string]struct{}),
	}
}

// markAffected records that runID/segmentID gained a new stored record this
// batch, deferring the (relatively expensive) lifecycle/gap-count
// reconciliation for them to reconcileAffected instead of recomputing it
// after every single record.
func (s *ingestStatements) markAffected(runID, segmentID string) {
	if runID != "" {
		s.affectedRuns[runID] = struct{}{}
	}
	if segmentID != "" {
		s.affectedSegments[segmentID] = struct{}{}
	}
}

// reconcileAffected reconciles segment gap/conflict counts and run lifecycle
// status once per distinct run/segment touched by the batch, instead of once
// per inserted record.
func (s *ingestStatements) reconcileAffected(ctx context.Context) error {
	for segmentID := range s.affectedSegments {
		if err := reconcileSegmentCounts(ctx, s, segmentID); err != nil {
			return err
		}
	}
	for runID := range s.affectedRuns {
		if err := reconcileRunSegmentLifecycle(ctx, s, runID); err != nil {
			return err
		}
	}
	return nil
}

func (s *ingestStatements) exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	stmt, ok := s.cache[query]
	if !ok {
		prepared, err := s.tx.PrepareContext(ctx, query)
		if err != nil {
			return nil, fmt.Errorf("prepare observability ingest statement: %w", err)
		}
		stmt = prepared
		s.cache[query] = stmt
	}
	return stmt.ExecContext(ctx, args...)
}

func (s *ingestStatements) queryRow(ctx context.Context, query string, args ...any) *sql.Row {
	return s.tx.QueryRowContext(ctx, query, args...)
}

func (s *ingestStatements) close() error {
	for _, stmt := range s.cache {
		if err := stmt.Close(); err != nil {
			return fmt.Errorf("close observability ingest statement: %w", err)
		}
	}
	return nil
}
