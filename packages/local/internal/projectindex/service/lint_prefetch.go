package service

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

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
