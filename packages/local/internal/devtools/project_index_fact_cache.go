package devtools

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) loadIndexFactCache(ctx context.Context, root, projectName string, loadedAt time.Time) (store.IndexData, bool) {
	if s.factStore == nil {
		return store.IndexData{}, false
	}
	index, ok, err := s.factStore.LoadSnapshot(ctx, root, projectName, loadedAt)
	if err != nil {
		return store.IndexData{}, false
	}
	return index, ok
}

func (s *Service) commitIndexPatch(ctx context.Context, patch IndexPatch) error {
	if s.factStore == nil {
		return nil
	}
	if err := s.factStore.CommitPhase(ctx, indexFactTransactionFromPatch(patch)); err != nil {
		// Cache writes must not make source indexing fail for fake, read-only,
		// or otherwise unwritable project roots. Direct FactStore calls remain
		// strict and are covered by transaction-level tests.
		return nil
	}
	return nil
}
