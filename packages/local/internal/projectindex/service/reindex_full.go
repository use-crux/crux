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
	s.indexState.Reset()
	s.indexMu.Unlock()

	cacheLoaded := false
	if cached, ok := s.indexCache.LoadSnapshot(ctx, root, projectName, run.startedAt); ok {
		cacheLoaded = true
		s.ApplyIndexPatch(ctx, projectindex.PatchFromSnapshot(cached, projectindex.PhaseCache, "ok"))
	}

	astResult, err := s.indexProjectAstPatch(ctx, root, configPath, projectName)
	if err != nil {
		return store.IndexData{}, s.publishFailedFullReindex(root, projectName, run.startedAt, err)
	}

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
	defer run.lintPrefetch.stop()

	return s.completeSemanticAndLint(ctx, run)
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
