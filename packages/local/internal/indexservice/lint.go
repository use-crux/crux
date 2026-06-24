package indexservice

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) applyProjectLintPatch(ctx context.Context, request projectindex.ProjectLintIndexRequest, generation uint64) (store.IndexData, error) {
	indexer, ok := s.indexer.(LintClient)
	if !ok {
		return s.indexReadModel(), nil
	}
	lintCtx, cancel := context.WithTimeout(ctx, ProjectIndexLintTimeout)
	defer cancel()
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = ProjectIndexLintBudget
	}
	patch, err := indexer.IndexProjectLintPatch(lintCtx, request)
	if err != nil {
		return store.IndexData{}, err
	}
	if isEmptyIndexPatch(patch) {
		return s.indexReadModel(), nil
	}
	if err := projectindex.ValidatePatchBudget(patch, request.Budget); err != nil {
		return store.IndexData{}, err
	}
	if patch.Phase == "" {
		patch.Phase = projectindex.PhaseQuality
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
) projectindex.ProjectLintIndexRequest {
	return projectindex.ProjectLintIndexRequest{
		Root:                root,
		ConfigPath:          configPath,
		ProjectName:         projectName,
		PreviousIndex:       index,
		ASTUsedNativeStatic: astUsedNativeStatic,
	}
}

func (s *Service) applyLintPatchIfCurrent(ctx context.Context, patch projectindex.IndexPatch, generation uint64) (store.IndexData, error) {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	if !s.indexState.IsCurrent(generation) {
		return s.indexReadModel(), nil
	}
	if err := s.indexCache.Commit(ctx, patch); err != nil {
		return store.IndexData{}, err
	}
	return s.applyIndexPatchLocked(patch), nil
}

func isEmptyIndexPatch(patch projectindex.IndexPatch) bool {
	return !projectindex.HasPatchFacts(patch.Facts) && len(patch.FactEnvelopes) == 0
}
