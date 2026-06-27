package service

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// semanticRequestMatcher reports whether a planned semantic request still matches
// the request finalized after the AST/source patch is applied. Full refreshes
// match on evidence (scope plus source profile); incremental refreshes match on
// scope only.
type semanticRequestMatcher func(planned, final projectindex.ProjectSemanticIndexRequest) bool

// refreshRun carries the per-refresh state shared by the full and incremental
// reindex flows. Both flows build a refreshRun once their AST/source patches are
// applied, then hand it to completeSemanticAndLint so the semantic/lint phase
// branching lives in exactly one place instead of being duplicated per flow.
type refreshRun struct {
	root        string
	configPath  string
	projectName string

	// startedAt marks when source discovery began, for indexing-status timing.
	startedAt time.Time
	// watch carries the watcher run identity and queue-coalescing telemetry.
	watch ProjectWatchRunOptions
	// semanticMode selects inline, background, or disabled semantic enrichment.
	semanticMode ProjectSemanticExecutionMode

	// generation pins the index generation that semantic and lint patches must
	// still match before they are applied.
	generation uint64
	// astUsedStaticIndex records whether the AST phase ran via the native Static
	// Index lane; the lint phase forwards it on its request.
	astUsedStaticIndex bool

	// previous is the snapshot the refresh started from: the incremental base, or
	// an empty snapshot for a full refresh.
	previous store.IndexData
	// index is the latest snapshot applied after the AST/source patches.
	index store.IndexData

	// semanticRequest is the finalized semantic request derived from index.
	semanticRequest projectindex.ProjectSemanticIndexRequest
	// semanticMatch decides whether a planned semantic task is still usable.
	semanticMatch semanticRequestMatcher
	// plannedSemantic is the optional in-flight semantic task started before the
	// AST patch finished. It is nil when no planner is available for the flow.
	plannedSemantic *projectSemanticPatchTask
	// lintPrefetch is the optional overlapping lint-input collection task.
	lintPrefetch *projectLintPrefetchTask

	// plannedSemanticDetached is set once ownership of plannedSemantic moves to a
	// background goroutine; the reindex flow must then not stop it on return.
	plannedSemanticDetached bool
}

// completeSemanticAndLint runs the semantic and lint phases for a refresh once
// its AST/source patches are applied. It is the single home for the semantic
// mode branching shared by the full and incremental flows.
func (s *Service) completeSemanticAndLint(ctx context.Context, run *refreshRun) (store.IndexData, error) {
	switch run.semanticMode {
	case ProjectSemanticDisabled:
		return s.completeDisabledSemantic(ctx, run)
	case ProjectSemanticBackground:
		return s.completeBackgroundSemantic(ctx, run)
	default:
		return s.applyPlannedSemanticPatch(ctx, run.semanticRequest, run.plannedSemantic, run.lintPrefetch, run.index, run.semanticMatch)
	}
}

func (s *Service) completeDisabledSemantic(ctx context.Context, run *refreshRun) (store.IndexData, error) {
	s.watchStatus.SemanticDisabled(run.watch.RunID)
	lintRequest, err := run.lintRequestWithPrefetch(run.index)
	if err != nil {
		return store.IndexData{}, err
	}
	return s.applyProjectLintPatch(ctx, lintRequest, run.generation)
}

func (s *Service) completeBackgroundSemantic(ctx context.Context, run *refreshRun) (store.IndexData, error) {
	lintRequest, err := run.lintRequestWithPrefetch(run.index)
	if err != nil {
		return store.IndexData{}, err
	}
	index, err := s.applyProjectLintPatch(ctx, lintRequest, run.generation)
	if err != nil {
		return store.IndexData{}, err
	}
	if run.plannedSemantic != nil {
		run.plannedSemanticDetached = true
		s.applyPlannedSemanticPatchInBackground(run.semanticRequest, run.plannedSemantic, index, run.semanticMatch)
	} else {
		s.applyProjectSemanticPatchInBackground(run.semanticRequest)
	}
	return index, nil
}

// lintRequestWithPrefetch builds the lint request for the refresh and folds in
// the overlapping prefetch result.
func (run *refreshRun) lintRequestWithPrefetch(index store.IndexData) (projectindex.ProjectLintIndexRequest, error) {
	request := projectLintIndexRequest(run.root, run.configPath, run.projectName, index, run.astUsedStaticIndex)
	if err := applyProjectLintPrefetch(&request, run.lintPrefetch); err != nil {
		return projectindex.ProjectLintIndexRequest{}, err
	}
	return request, nil
}
