package service

import (
	"context"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (p projectIndexPipeline) reindexProjectWithOptions(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	options ProjectReindexOptions,
) (store.IndexData, error) {
	s := p.service
	if s.indexer == nil {
		return store.IndexData{}, fmt.Errorf("project index indexer is not configured")
	}
	ctx, cancel := projectReindexContext(ctx)
	defer cancel()

	semanticMode := options.semanticMode()
	s.startProjectSemanticPrewarm(ctx, semanticMode)
	plannedSemanticCtx := ctx
	if semanticMode == ProjectSemanticBackground {
		plannedSemanticCtx = s.ctx
	}

	run := &refreshRun{
		root:            root,
		configPath:      configPath,
		projectName:     projectName,
		startedAt:       time.Now(),
		watch:           options.Watch,
		semanticMode:    semanticMode,
		semanticMatch:   projectSemanticRequestEvidenceMatches,
		plannedSemantic: s.startPlannedProjectSemanticPatch(plannedSemanticCtx, semanticMode, root, configPath, projectName),
	}
	defer func() {
		if !run.plannedSemanticDetached {
			run.plannedSemantic.stop()
		}
	}()

	s.indexMu.Lock()
	previousState := s.indexState.Checkpoint()
	previousBase := s.indexState.Index()
	s.indexState.Reset()
	s.indexMu.Unlock()
	if err := s.hydrateRuntimeOverlays(ctx, root); err != nil {
		s.restoreBaseAfterFailedReindex(previousState)
		return store.IndexData{}, fmt.Errorf("hydrate runtime overlays: %w", err)
	}

	cacheLoaded := false
	cached, cacheHit, err := s.indexCache.LoadSnapshot(ctx, root, projectName, run.startedAt)
	if err != nil {
		return store.IndexData{}, s.publishFailedFullReindex(root, projectName, run.startedAt, fmt.Errorf("load Project Index cache: %w", err))
	}
	if cacheHit {
		cacheLoaded = true
		s.ApplyIndexPatch(ctx, projectindex.PatchFromSnapshot(cached, projectindex.PhaseCache, "ok"))
	}

	astResult, err := s.indexProjectAstPatch(ctx, root, configPath, projectName)
	if err != nil {
		s.restoreBaseAfterFailedReindex(previousState)
		return store.IndexData{}, s.publishFailedFullReindex(root, projectName, run.startedAt, err)
	}
	s.setConfigDependencies(root, astResult.ConfigDependencies)

	patch := astResult.Patch
	if patch.Phase == "" {
		patch.Phase = projectindex.PhaseAST
	}
	patch = normalizePatchIdentity(patch, root, configPath, projectName)
	patch.Indexing = store.ReadyIndexIndexingStatus(
		patch.FinishedAt,
		time.Since(run.startedAt),
		len(patch.Facts.Sources),
		len(patch.Facts.Diagnostics),
		projectindex.HasSourceOnlyDiagnostic(patch.Facts.Diagnostics),
	)
	if cacheLoaded && patch.Indexing.Cache != nil {
		patch.Indexing.Cache.Status = "hit"
		patch.Indexing.Cache.LoadedAt = run.startedAt.UTC().Format(time.RFC3339Nano)
	}
	if isIncompleteASTPatch(patch) && !projectindex.IsEmptyIndex(previousBase) {
		s.indexMu.Lock()
		s.indexState.Restore(previousState)
		s.indexMu.Unlock()
	}
	index, err := s.commitAndApply(ctx, patch)
	if err != nil {
		return store.IndexData{}, err
	}

	run.index = index
	run.astUsedStaticIndex = astResult.UsedStaticIndex
	run.semanticRequest = projectSemanticIndexRequest(root, configPath, projectName, index, nil, patch.SemanticSourceProfile)
	run.semanticRequest.IndexGeneration = s.indexState.CurrentGeneration()
	run.semanticRequest.WatchRunID = options.Watch.RunID
	run.semanticRequest.ASTUsedStaticIndex = astResult.UsedStaticIndex
	run.generation = run.semanticRequest.IndexGeneration

	run.lintPrefetch = s.startProjectLintPrefetch(ctx, projectLintIndexRequest(root, configPath, projectName, index, astResult.UsedStaticIndex))
	defer func() {
		if !run.lintPrefetchDetached {
			run.lintPrefetch.stop()
		}
	}()

	return s.completeSemanticAndLint(ctx, run)
}

func (s *Service) restoreBaseAfterFailedReindex(previous projectindex.StateCheckpoint) {
	s.indexMu.Lock()
	defer s.indexMu.Unlock()
	s.indexState.Restore(previous)
	base := s.registeredBaseLocked()
	s.store.SetIndexData(s.runtimeOverlays.Project(base))
}

// publishFailedFullReindex records and publishes a degraded snapshot when source
// discovery fails, then returns the original cause for the caller to surface.
func (s *Service) publishFailedFullReindex(root, projectName string, startedAt time.Time, cause error) error {
	failed := s.store.GetIndex()
	if failed.Project == nil && root != "" {
		failed.Project = &store.ProjectIdentity{Root: root, Name: projectName}
	}
	failed.Indexing = store.FailedIndexIndexingStatus(time.Since(startedAt), cause.Error())
	s.store.SetIndexData(failed)
	s.publishIndex(s.indexReadModel())
	return cause
}
