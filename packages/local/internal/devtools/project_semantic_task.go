package devtools

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type projectSemanticPatchTask struct {
	cancel context.CancelFunc
	done   <-chan projectSemanticPatchTaskResult
}

type projectSemanticPatchTaskResult struct {
	patch     projectindex.IndexPatch
	err       error
	startedAt time.Time
	stage     string
	request   projectindex.ProjectSemanticIndexRequest
}

func (s *Service) startPlannedProjectSemanticPatch(
	ctx context.Context,
	mode ProjectSemanticExecutionMode,
	root string,
	configPath string,
	projectName string,
) *projectSemanticPatchTask {
	if mode == ProjectSemanticDisabled {
		return nil
	}
	planner, hasPlanner := s.indexer.(projectindex.ProjectSemanticPlanner)
	_, hasIndexer := s.indexer.(projectindex.ProjectSemanticIndexer)
	if !hasPlanner || !hasIndexer {
		return nil
	}
	taskCtx, cancel := context.WithCancel(ctx)
	done := make(chan projectSemanticPatchTaskResult, 1)
	go func() {
		request, err := planner.PlanProjectSemanticRequest(taskCtx, root, configPath, projectName)
		if err != nil {
			done <- projectSemanticPatchTaskResult{err: err, stage: "plan"}
			return
		}
		s.indexProjectSemanticPatchTask(taskCtx, request, done)
	}()
	return &projectSemanticPatchTask{cancel: cancel, done: done}
}

func (s *Service) startProjectSemanticPatchTask(
	ctx context.Context,
	mode ProjectSemanticExecutionMode,
	request projectindex.ProjectSemanticIndexRequest,
) *projectSemanticPatchTask {
	if mode == ProjectSemanticDisabled {
		return nil
	}
	if _, ok := s.indexer.(projectindex.ProjectSemanticIndexer); !ok {
		return nil
	}
	taskCtx, cancel := context.WithCancel(ctx)
	done := make(chan projectSemanticPatchTaskResult, 1)
	go func() {
		s.indexProjectSemanticPatchTask(taskCtx, request, done)
	}()
	return &projectSemanticPatchTask{cancel: cancel, done: done}
}

func (s *Service) indexProjectSemanticPatchTask(
	ctx context.Context,
	request projectindex.ProjectSemanticIndexRequest,
	done chan<- projectSemanticPatchTaskResult,
) {
	indexer, ok := s.indexer.(projectindex.ProjectSemanticIndexer)
	if !ok {
		done <- projectSemanticPatchTaskResult{stage: "missing-indexer", request: request}
		return
	}
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = projectIndexSemanticBudget
	}
	semanticCtx, semanticCancel := context.WithTimeout(ctx, projectIndexSemanticTimeout)
	defer semanticCancel()
	startedAt := time.Now()
	patch, err := indexer.IndexProjectSemanticPatch(semanticCtx, request)
	done <- projectSemanticPatchTaskResult{
		patch:     patch,
		err:       err,
		startedAt: startedAt,
		stage:     "semantic",
		request:   request,
	}
}

func (t *projectSemanticPatchTask) wait() projectSemanticPatchTaskResult {
	if t == nil {
		return projectSemanticPatchTaskResult{}
	}
	return <-t.done
}

func (t *projectSemanticPatchTask) stop() {
	if t != nil && t.cancel != nil {
		t.cancel()
	}
}

func (s *Service) applyPlannedProjectSemanticPatch(
	ctx context.Context,
	request projectindex.ProjectSemanticIndexRequest,
	task *projectSemanticPatchTask,
	lintPrefetch *projectLintPrefetchTask,
	astIndex store.IndexData,
) (store.IndexData, error) {
	if task == nil {
		return s.applyProjectSemanticPatch(ctx, request, lintPrefetch)
	}
	result := task.wait()
	if result.stage != "semantic" || !projectSemanticRequestEvidenceMatches(result.request, request) {
		return s.applyProjectSemanticPatch(ctx, request, lintPrefetch)
	}
	patch := projectindex.JoinSemanticPatch(result.patch, astIndex)
	return s.applyProjectSemanticPatchResult(ctx, request, result.startedAt, patch, result.err, lintPrefetch)
}

func (s *Service) applyPlannedProjectSemanticPatchInBackground(
	request projectindex.ProjectSemanticIndexRequest,
	task *projectSemanticPatchTask,
	astIndex store.IndexData,
) {
	go func() {
		_, _ = s.applyPlannedProjectSemanticPatch(s.ctx, request, task, nil, astIndex)
	}()
}
