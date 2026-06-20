package devtools

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) applyProjectSemanticPatch(ctx context.Context, request ProjectSemanticIndexRequest) (store.IndexData, error) {
	indexer, ok := s.indexer.(ProjectSemanticIndexer)
	if !ok {
		return s.indexReadModel(), nil
	}
	semanticStartedAt := time.Now()
	semanticCtx, cancel := context.WithTimeout(ctx, projectIndexSemanticTimeout)
	defer cancel()
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = projectIndexSemanticBudget
	}
	patch, err := indexer.IndexProjectSemanticPatch(semanticCtx, request)
	if err != nil {
		index, applied, applyErr := s.applyProjectSemanticDegradedPatch(ctx, request, semanticStartedAt, "index.semantic_degraded", err.Error())
		if !applied {
			s.watchStatus.SemanticStaleDropped(request.WatchRunID)
		} else if applyErr == nil {
			s.watchStatus.SemanticDegraded(request.WatchRunID)
		}
		return index, applyErr
	}
	if err := validateIndexPatchBudget(patch, request.Budget); err != nil {
		index, applied, applyErr := s.applyProjectSemanticDegradedPatch(ctx, request, semanticStartedAt, "index.semantic_budget_exceeded", err.Error())
		if !applied {
			s.watchStatus.SemanticStaleDropped(request.WatchRunID)
		} else if applyErr == nil {
			s.watchStatus.SemanticDegraded(request.WatchRunID)
		}
		return index, applyErr
	}
	if patch.Phase == "" {
		patch.Phase = indexPatchPhaseSemantic
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
	return index, nil
}

func (s *Service) applyProjectSemanticPatchInBackground(request ProjectSemanticIndexRequest) {
	go func() {
		if s == nil {
			return
		}
		_, _ = s.applyProjectSemanticPatch(s.ctx, request)
	}()
}

func semanticSourceProfileFromPatches(patches []IndexPatch) *SemanticSourceProfile {
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
	request ProjectSemanticIndexRequest,
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
	patch := IndexPatch{
		SchemaVersion: current.SchemaVersion,
		Phase:         indexPatchPhaseSemantic,
		Project:       project,
		StartedAt:     startedAt.UTC().Format(time.RFC3339Nano),
		FinishedAt:    finishedAt,
		Status:        "degraded",
		Indexing:      store.IndexIndexingWithSemanticDegraded(current.Indexing, time.Since(startedAt), message),
		Facts: IndexPatchFacts{
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

func (s *Service) applySemanticPatchIfCurrent(ctx context.Context, patch IndexPatch, generation uint64) (store.IndexData, bool, error) {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	if !s.indexGeneration.IsCurrent(generation) {
		return s.indexReadModel(), false, nil
	}
	if err := s.commitIndexPatch(ctx, patch); err != nil {
		return store.IndexData{}, true, err
	}
	return s.applyIndexPatchLocked(patch), true, nil
}

func (s *Service) applyReadySemanticPatchIfCurrent(
	ctx context.Context,
	patch IndexPatch,
	generation uint64,
	startedAt time.Time,
) (store.IndexData, bool, error) {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	if !s.indexGeneration.IsCurrent(generation) {
		return s.indexReadModel(), false, nil
	}
	current := s.store.GetIndex()
	clearsSourceOnly := hasSourceOnlyDiagnostic(current.Diagnostics) && (patch.Status == "" || patch.Status == "ok")
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
		astDiagnostics := filterRuntimeIndexDiagnostics(s.indexPatch.DiagnosticsByPhase[indexPatchPhaseAST])
		indexing.AST.DiagnosticCount = len(astDiagnostics)
		s.indexPatch.DiagnosticsByPhase[indexPatchPhaseAST] = astDiagnostics
		if patch.Facts.Diagnostics == nil {
			patch.Facts.Diagnostics = []store.IndexDiagnostic{}
		}
	}
	patch.Indexing = indexing
	if err := s.commitIndexPatch(ctx, patch); err != nil {
		return store.IndexData{}, true, err
	}
	return s.applyIndexPatchLocked(patch), true, nil
}
