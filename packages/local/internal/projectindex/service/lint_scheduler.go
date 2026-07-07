package service

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/cache"
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

func (s *Service) applyProjectLintPatchInBackground(run *refreshRun, index store.IndexData) {
	if s == nil || run == nil {
		return
	}
	run.lintPrefetchDetached = true
	request := projectLintIndexRequest(run.root, run.configPath, run.projectName, index, run.astUsedStaticIndex)
	generation := run.generation
	prefetch := run.lintPrefetch
	go func() {
		defer prefetch.stop()
		if err := applyProjectLintPrefetch(&request, prefetch); err != nil {
			return
		}
		_, _ = s.applyProjectLintPatch(s.ctx, request, generation)
	}()
}

func projectLintIndexRequest(
	root string,
	configPath string,
	projectName string,
	index store.IndexData,
	astUsedStaticIndex bool,
) projectindex.ProjectLintIndexRequest {
	return projectindex.ProjectLintIndexRequest{
		Root:               root,
		ConfigPath:         configPath,
		ProjectName:        projectName,
		PreviousIndex:      index,
		ASTUsedStaticIndex: astUsedStaticIndex,
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
	return !cache.HasPatchFacts(patch.Facts) && len(patch.FactEnvelopes) == 0
}

// projectLintPrefetchTask runs immutable lint input collection in the background
// so it can overlap semantic enrichment for the same refresh.
type projectLintPrefetchTask struct {
	cancel context.CancelFunc
	done   <-chan projectLintPrefetchTaskResult
}

type projectLintPrefetchTaskResult struct {
	prefetch projectindex.ProjectLintPrefetchResult
	err      error
}

func (s *Service) startProjectLintPrefetch(ctx context.Context, request projectindex.ProjectLintIndexRequest) *projectLintPrefetchTask {
	indexer, ok := s.indexer.(LintPrefetchClient)
	if !ok {
		return nil
	}
	prefetchCtx, cancel := context.WithTimeout(ctx, ProjectIndexLintTimeout)
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = ProjectIndexLintBudget
	}
	done := make(chan projectLintPrefetchTaskResult, 1)
	go func() {
		prefetch, err := indexer.PrefetchProjectLintFacts(prefetchCtx, request)
		done <- projectLintPrefetchTaskResult{prefetch: prefetch, err: err}
	}()
	return &projectLintPrefetchTask{cancel: cancel, done: done}
}

func (t *projectLintPrefetchTask) wait() (*projectindex.ProjectLintPrefetchResult, error) {
	if t == nil {
		return nil, nil
	}
	result := <-t.done
	if result.err != nil {
		return nil, result.err
	}
	return &result.prefetch, nil
}

func (t *projectLintPrefetchTask) stop() {
	if t != nil && t.cancel != nil {
		t.cancel()
	}
}

func applyProjectLintPrefetch(request *projectindex.ProjectLintIndexRequest, prefetch *projectLintPrefetchTask) error {
	if request == nil {
		return nil
	}
	result, err := prefetch.wait()
	if err != nil {
		return err
	}
	request.Prefetch = result
	return nil
}
