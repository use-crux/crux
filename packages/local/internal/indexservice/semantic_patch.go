package indexservice

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) applyProjectSemanticPatch(
	ctx context.Context,
	request projectindex.ProjectSemanticIndexRequest,
	lintPrefetch *projectLintPrefetchTask,
) (store.IndexData, error) {
	indexer, ok := s.indexer.(SemanticClient)
	if !ok {
		index := s.indexReadModel()
		lintRequest := projectLintIndexRequest(
			request.Root,
			request.ConfigPath,
			request.ProjectName,
			index,
			request.ASTUsedNativeStatic,
		)
		if err := applyProjectLintPrefetch(&lintRequest, lintPrefetch); err != nil {
			return store.IndexData{}, err
		}
		return s.applyProjectLintPatch(ctx, lintRequest, request.IndexGeneration)
	}
	semanticStartedAt := time.Now()
	semanticCtx, cancel := context.WithTimeout(ctx, ProjectIndexSemanticTimeout)
	defer cancel()
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = ProjectIndexSemanticBudget
	}
	patch, err := indexer.IndexProjectSemanticPatch(semanticCtx, request)
	return s.applyProjectSemanticPatchResult(ctx, request, semanticStartedAt, patch, err, lintPrefetch)
}

func (s *Service) applyProjectSemanticPatchResult(
	ctx context.Context,
	request projectindex.ProjectSemanticIndexRequest,
	semanticStartedAt time.Time,
	patch projectindex.IndexPatch,
	semanticErr error,
	lintPrefetch *projectLintPrefetchTask,
) (store.IndexData, error) {
	if semanticStartedAt.IsZero() {
		semanticStartedAt = time.Now()
	}
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = ProjectIndexSemanticBudget
	}
	if semanticErr != nil {
		index, applied, applyErr := s.applyProjectSemanticDegradedPatch(ctx, request, semanticStartedAt, "index.semantic_degraded", semanticErr.Error())
		if !applied {
			s.watchStatus.SemanticStaleDropped(request.WatchRunID)
		} else if applyErr == nil {
			s.watchStatus.SemanticDegraded(request.WatchRunID)
		}
		return index, applyErr
	}
	if err := projectindex.ValidatePatchBudget(patch, request.Budget); err != nil {
		index, applied, applyErr := s.applyProjectSemanticDegradedPatch(ctx, request, semanticStartedAt, "index.semantic_budget_exceeded", err.Error())
		if !applied {
			s.watchStatus.SemanticStaleDropped(request.WatchRunID)
		} else if applyErr == nil {
			s.watchStatus.SemanticDegraded(request.WatchRunID)
		}
		return index, applyErr
	}
	if patch.Phase == "" {
		patch.Phase = projectindex.PhaseSemantic
	}
	if patch.Project.Root == "" {
		patch.Project = store.ProjectIdentity{Root: request.Root, Name: request.ProjectName, ConfigFile: request.ConfigPath}
	}
	if patch.FinishedAt == "" {
		patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	index, applied, err := s.applyReadySemanticPatchIfCurrent(ctx, patch, request.IndexGeneration, semanticStartedAt)
	if !applied {
		s.watchStatus.SemanticStaleDropped(request.WatchRunID)
		return index, nil
	}
	if err != nil {
		return store.IndexData{}, err
	}
	if patch.Status == "degraded" {
		s.watchStatus.SemanticDegraded(request.WatchRunID)
	} else {
		s.watchStatus.SemanticReady(request.WatchRunID)
	}
	lintRequest := projectLintIndexRequest(
		request.Root,
		request.ConfigPath,
		request.ProjectName,
		index,
		request.ASTUsedNativeStatic,
	)
	if err := applyProjectLintPrefetch(&lintRequest, lintPrefetch); err != nil {
		return store.IndexData{}, err
	}
	return s.applyProjectLintPatch(ctx, lintRequest, request.IndexGeneration)
}

func (s *Service) applyProjectSemanticPatchInBackground(request projectindex.ProjectSemanticIndexRequest) {
	go func() {
		if s == nil {
			return
		}
		if _, ok := s.indexer.(SemanticClient); !ok {
			return
		}
		_, _ = s.applyProjectSemanticPatch(s.ctx, request, nil)
	}()
}

func semanticSourceProfileFromPatches(patches []projectindex.IndexPatch) *projectindex.SemanticSourceProfile {
	for index := len(patches) - 1; index >= 0; index-- {
		if patches[index].SemanticSourceProfile != nil {
			return patches[index].SemanticSourceProfile
		}
	}
	return nil
}

func watchSemanticStatusForMode(mode ProjectSemanticExecutionMode) string {
	switch mode {
	case ProjectSemanticBackground:
		return "pending"
	case ProjectSemanticDisabled:
		return "disabled"
	default:
		return "inline"
	}
}

func (s *Service) applyProjectSemanticDegradedPatch(
	ctx context.Context,
	request projectindex.ProjectSemanticIndexRequest,
	startedAt time.Time,
	code string,
	message string,
) (store.IndexData, bool, error) {
	current := s.store.GetIndex()
	project := store.ProjectIdentity{Root: request.Root, Name: request.ProjectName, ConfigFile: request.ConfigPath}
	if current.Project != nil {
		project = *current.Project
	}
	finishedAt := time.Now().UTC().Format(time.RFC3339Nano)
	patch := projectindex.IndexPatch{
		SchemaVersion: current.SchemaVersion,
		Phase:         projectindex.PhaseSemantic,
		Project:       project,
		StartedAt:     startedAt.UTC().Format(time.RFC3339Nano),
		FinishedAt:    finishedAt,
		Status:        "degraded",
		Indexing:      store.IndexIndexingWithSemanticDegraded(current.Indexing, time.Since(startedAt), message),
		Facts: projectindex.IndexPatchFacts{
			Diagnostics: []store.IndexDiagnostic{
				{
					ID:           "diagnostic:semantic:degraded",
					Severity:     "info",
					Code:         code,
					Message:      message,
					SuggestedFix: "AST index data is still available. Semantic enrichment will retry on the next index refresh.",
				},
			},
		},
	}
	return s.applySemanticPatchIfCurrent(ctx, patch, request.IndexGeneration)
}

func (s *Service) applySemanticPatchIfCurrent(ctx context.Context, patch projectindex.IndexPatch, generation uint64) (store.IndexData, bool, error) {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	if !s.indexState.IsCurrent(generation) {
		return s.indexReadModel(), false, nil
	}
	if err := s.indexCache.Commit(ctx, patch); err != nil {
		return store.IndexData{}, true, err
	}
	return s.applyIndexPatchLocked(patch), true, nil
}

func (s *Service) applyReadySemanticPatchIfCurrent(
	ctx context.Context,
	patch projectindex.IndexPatch,
	generation uint64,
	startedAt time.Time,
) (store.IndexData, bool, error) {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	if !s.indexState.IsCurrent(generation) {
		return s.indexReadModel(), false, nil
	}
	current := s.store.GetIndex()
	clearsSourceOnly := projectindex.HasSourceOnlyDiagnostic(current.Diagnostics) && (patch.Status == "" || patch.Status == "ok")
	indexing := store.IndexIndexingWithSemanticReady(
		current.Indexing,
		patch.FinishedAt,
		time.Since(startedAt),
		len(patch.Facts.Diagnostics),
		len(patch.Facts.Definitions),
	)
	if clearsSourceOnly {
		indexing.Status = "ready"
		indexing.Error = ""
		if indexing.AST.Status == "degraded" {
			indexing.AST.Status = "ready"
		}
		astDiagnostics := projectindex.FilterRuntimeDiagnostics(s.indexState.PhaseDiagnostics(projectindex.PhaseAST))
		indexing.AST.DiagnosticCount = len(astDiagnostics)
		s.indexState.SetPhaseDiagnostics(projectindex.PhaseAST, astDiagnostics)
		if patch.Facts.Diagnostics == nil {
			patch.Facts.Diagnostics = []store.IndexDiagnostic{}
		}
	}
	patch.Indexing = indexing
	if err := s.indexCache.Commit(ctx, patch); err != nil {
		return store.IndexData{}, true, err
	}
	return s.applyIndexPatchLocked(patch), true, nil
}
