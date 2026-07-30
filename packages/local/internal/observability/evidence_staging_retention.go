package observability

import (
	"context"
	"fmt"
	"time"
)

func (s *Service) cleanupExpiredEvidenceCandidates(
	ctx context.Context,
	now time.Time,
) (err error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin evidence staging retention: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	statements := newIngestStatements(tx)
	defer func() {
		if closeErr := statements.close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()
	if err := expireEvidenceStagingCandidates(
		ctx,
		statements,
		now.UTC(),
	); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit evidence staging retention: %w", err)
	}
	committed = true
	return nil
}
