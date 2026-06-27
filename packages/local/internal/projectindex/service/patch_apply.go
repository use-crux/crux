package service

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ApplyIndexPatch applies a phase patch and publishes the resulting snapshot.
func (s *Service) ApplyIndexPatch(_ context.Context, patch projectindex.IndexPatch) store.IndexData {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	return s.applyIndexPatchLocked(patch)
}

func (s *Service) applyIndexPatchLocked(patch projectindex.IndexPatch) store.IndexData {
	applied := s.indexState.Apply(patch)
	s.store.SetIndexData(applied)
	index := s.indexReadModel()
	s.publishIndex(index)
	return index
}

// commitAndApply persists a patch to the warm-start cache, then applies and
// publishes it. It is the single write path shared by the full and incremental
// reindex flows.
func (s *Service) commitAndApply(ctx context.Context, patch projectindex.IndexPatch) (store.IndexData, error) {
	if err := s.indexCache.Commit(ctx, patch); err != nil {
		return store.IndexData{}, err
	}
	return s.ApplyIndexPatch(ctx, patch), nil
}

// normalizePatchIdentity fills in the project identity and finish timestamp that
// every applied patch must carry when a phase client leaves them empty.
func normalizePatchIdentity(
	patch projectindex.IndexPatch,
	root string,
	configPath string,
	projectName string,
) projectindex.IndexPatch {
	if patch.Project.Root == "" {
		patch.Project = store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
	}
	if patch.FinishedAt == "" {
		patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return patch
}

func (s *Service) indexReadModel() store.IndexData {
	if s.readModel != nil {
		return s.readModel()
	}
	return s.store.GetIndex()
}

func (s *Service) publishIndex(index store.IndexData) {
	if s.publish != nil {
		s.publish(index)
	}
}
