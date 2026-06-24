package devtools

import (
	"context"
)

type projectLintPrefetchTask struct {
	cancel context.CancelFunc
	done   <-chan projectLintPrefetchTaskResult
}

type projectLintPrefetchTaskResult struct {
	prefetch ProjectLintPrefetchResult
	err      error
}

func (s *Service) startProjectLintPrefetch(ctx context.Context, request ProjectLintIndexRequest) *projectLintPrefetchTask {
	indexer, ok := s.indexer.(ProjectLintPrefetchIndexer)
	if !ok {
		return nil
	}
	prefetchCtx, cancel := context.WithTimeout(ctx, projectIndexLintTimeout)
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = projectIndexLintBudget
	}
	done := make(chan projectLintPrefetchTaskResult, 1)
	go func() {
		prefetch, err := indexer.PrefetchProjectLintFacts(prefetchCtx, request)
		done <- projectLintPrefetchTaskResult{prefetch: prefetch, err: err}
	}()
	return &projectLintPrefetchTask{cancel: cancel, done: done}
}

func (t *projectLintPrefetchTask) wait() (*ProjectLintPrefetchResult, error) {
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

func applyProjectLintPrefetch(request *ProjectLintIndexRequest, prefetch *projectLintPrefetchTask) error {
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
