package service

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) applyProjectRuntimePatch(ctx context.Context, request projectindex.ProjectRuntimeIndexRequest) (store.IndexData, error) {
	indexer, ok := s.indexer.(RuntimeClient)
	runtimeStartedAt := time.Now()
	if !ok {
		return s.applyProjectRuntimeDegradedPatch(ctx, request, runtimeStartedAt, "index.runtime_unavailable", "runtime-rich Project Index worker is not configured")
	}
	runtimeCtx, cancel := context.WithTimeout(ctx, ProjectIndexRuntimeTimeout)
	defer cancel()
	if isZeroIndexPatchBudget(request.Budget) {
		request.Budget = ProjectIndexRuntimeBudget
	}
	patch, err := indexer.IndexProjectRuntimePatch(runtimeCtx, request)
	if err != nil {
		return s.applyProjectRuntimeDegradedPatch(ctx, request, runtimeStartedAt, "index.runtime_degraded", err.Error())
	}
	if err := projectindex.ValidatePatchBudget(patch, request.Budget); err != nil {
		return s.applyProjectRuntimeDegradedPatch(ctx, request, runtimeStartedAt, "index.runtime_budget_exceeded", err.Error())
	}
	if patch.Invalidates != nil && patch.Invalidates.All {
		return s.applyProjectRuntimeDegradedPatch(ctx, request, runtimeStartedAt, "index.runtime_invalid_patch", "runtime-rich patch cannot invalidate the source Project Index")
	}
	if patch.Phase == "" {
		patch.Phase = projectindex.PhaseRuntime
	}
	if patch.Project.Root == "" {
		patch.Project = projectIdentityFromRuntimeRequest(request)
	}
	if patch.FinishedAt == "" {
		patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if err := s.indexCache.Commit(ctx, patch); err != nil {
		return store.IndexData{}, err
	}
	return s.ApplyIndexPatch(ctx, patch), nil
}

func (s *Service) applyProjectRuntimeDegradedPatch(
	ctx context.Context,
	request projectindex.ProjectRuntimeIndexRequest,
	startedAt time.Time,
	code string,
	message string,
) (store.IndexData, error) {
	patch := projectindex.IndexPatch{
		SchemaVersion: request.PreviousIndex.SchemaVersion,
		Phase:         projectindex.PhaseRuntime,
		Project:       projectIdentityFromRuntimeRequest(request),
		StartedAt:     startedAt.UTC().Format(time.RFC3339Nano),
		FinishedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Status:        "degraded",
		Facts: projectindex.IndexPatchFacts{
			Diagnostics: []store.IndexDiagnostic{
				{
					ID:           "diagnostic:runtime:degraded",
					Severity:     "info",
					Code:         code,
					Message:      message,
					SuggestedFix: "Source and semantic Project Index data is still available. Run runtime-rich indexing again after fixing the runtime import.",
				},
			},
		},
	}
	if err := s.indexCache.Commit(ctx, patch); err != nil {
		return store.IndexData{}, err
	}
	return s.ApplyIndexPatch(ctx, patch), nil
}

func projectIdentityFromRuntimeRequest(request projectindex.ProjectRuntimeIndexRequest) store.ProjectIdentity {
	if request.PreviousIndex.Project != nil {
		return *request.PreviousIndex.Project
	}
	return store.ProjectIdentity{Root: request.Root, Name: request.ProjectName, ConfigFile: request.ConfigPath}
}
