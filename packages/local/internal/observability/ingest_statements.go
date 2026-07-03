package observability

import (
	"context"
	"database/sql"
	"fmt"
)

type ingestStatements struct {
	tx    *sql.Tx
	cache map[string]*sql.Stmt
}

func newIngestStatements(tx *sql.Tx) *ingestStatements {
	return &ingestStatements{
		tx:    tx,
		cache: make(map[string]*sql.Stmt),
	}
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

func (s *ingestStatements) close() error {
	for _, stmt := range s.cache {
		if err := stmt.Close(); err != nil {
			return fmt.Errorf("close observability ingest statement: %w", err)
		}
	}
	return nil
}
