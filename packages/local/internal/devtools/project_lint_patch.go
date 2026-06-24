package devtools

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) applyProjectLintPatch(ctx context.Context, request ProjectLintIndexRequest, generation uint64) (store.IndexData, error) {
	indexer, ok := s.indexer.(ProjectLintIndexer)
	if !ok {
		return s.indexReadModel(), nil
	}
	lintCtx, cancel := context.WithTimeout(ctx, projectIndexLintTimeout)
	defer cancel()
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = projectIndexLintBudget
	}
	patch, err := indexer.IndexProjectLintPatch(lintCtx, request)
	if err != nil {
		return store.IndexData{}, err
	}
	if isEmptyIndexPatch(patch) {
		return s.indexReadModel(), nil
	}
	if err := validateIndexPatchBudget(patch, request.Budget); err != nil {
		return store.IndexData{}, err
	}
	if patch.Phase == "" {
		patch.Phase = indexPatchPhaseQuality
	}
	if patch.Project.Root == "" {
		patch.Project = store.ProjectIdentity{Root: request.Root, Name: request.ProjectName, ConfigFile: request.ConfigPath}
	}
	if patch.FinishedAt == "" {
		patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return s.applyLintPatchIfCurrent(ctx, patch, generation)
}

func projectLintIndexRequest(
	root string,
	configPath string,
	projectName string,
	index store.IndexData,
	astUsedNativeStatic bool,
) ProjectLintIndexRequest {
	return ProjectLintIndexRequest{
		Root:                root,
		ConfigPath:          configPath,
		ProjectName:         projectName,
		PreviousIndex:       index,
		ASTUsedNativeStatic: astUsedNativeStatic,
	}
}

func (s *Service) applyLintPatchIfCurrent(ctx context.Context, patch IndexPatch, generation uint64) (store.IndexData, error) {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	if !s.indexGeneration.IsCurrent(generation) {
		return s.indexReadModel(), nil
	}
	if err := s.commitIndexPatch(ctx, patch); err != nil {
		return store.IndexData{}, err
	}
	return s.applyIndexPatchLocked(patch), nil
}

func isEmptyIndexPatch(patch IndexPatch) bool {
	return !hasIndexPatchFacts(patch.Facts) && len(patch.FactEnvelopes) == 0
}
