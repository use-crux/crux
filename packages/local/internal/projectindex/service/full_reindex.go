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
	plannedSemantic := s.startPlannedProjectSemanticPatch(plannedSemanticCtx, semanticMode, root, configPath, projectName)
	plannedSemanticDetached := false
	defer func() {
		if !plannedSemanticDetached {
			plannedSemantic.stop()
		}
	}()

	startedAt := time.Now()
	s.indexMu.Lock()
	s.indexState.Reset()
	s.indexMu.Unlock()

	cacheLoaded := false
	if cached, ok := s.indexCache.LoadSnapshot(ctx, root, projectName, startedAt); ok {
		cacheLoaded = true
		s.ApplyIndexPatch(ctx, projectindex.PatchFromSnapshot(cached, projectindex.PhaseCache, "ok"))
	}

	astResult, err := s.indexProjectAstPatch(ctx, root, configPath, projectName)
	if err != nil {
		failed := s.store.GetIndex()
		if failed.Project == nil && root != "" {
			failed.Project = &store.ProjectIdentity{Root: root, Name: projectName}
		}
		failed.Indexing = store.FailedIndexIndexingStatus(time.Since(startedAt), err.Error())
		s.store.SetIndexData(failed)
		s.publishIndex(s.indexReadModel())
		return store.IndexData{}, err
	}

	patch := astResult.Patch
	if patch.Phase == "" {
		patch.Phase = projectindex.PhaseAST
	}
	if patch.Project.Root == "" {
		patch.Project = store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
	}
	if patch.FinishedAt == "" {
		patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	patch.Indexing = store.ReadyIndexIndexingStatus(
		patch.FinishedAt,
		time.Since(startedAt),
		len(patch.Facts.Sources),
		len(patch.Facts.Diagnostics),
		projectindex.HasSourceOnlyDiagnostic(patch.Facts.Diagnostics),
	)
	if cacheLoaded && patch.Indexing.Cache != nil {
		patch.Indexing.Cache.Status = "hit"
		patch.Indexing.Cache.LoadedAt = startedAt.UTC().Format(time.RFC3339Nano)
	}
	if err := s.indexCache.Commit(ctx, patch); err != nil {
		return store.IndexData{}, err
	}

	index := s.ApplyIndexPatch(ctx, patch)
	semanticRequest := projectSemanticIndexRequest(root, configPath, projectName, index, nil, patch.SemanticSourceProfile)
	semanticRequest.IndexGeneration = s.indexState.CurrentGeneration()
	semanticRequest.WatchRunID = options.Watch.RunID
	semanticRequest.ASTUsedStaticIndex = astResult.UsedStaticIndex
	lintPrefetch := s.startProjectLintPrefetch(ctx, projectLintIndexRequest(root, configPath, projectName, index, astResult.UsedStaticIndex))
	defer lintPrefetch.stop()

	switch semanticMode {
	case ProjectSemanticDisabled:
		s.watchStatus.SemanticDisabled(options.Watch.RunID)
		lintRequest := projectLintIndexRequest(root, configPath, projectName, index, astResult.UsedStaticIndex)
		if err := applyProjectLintPrefetch(&lintRequest, lintPrefetch); err != nil {
			return store.IndexData{}, err
		}
		return s.applyProjectLintPatch(ctx, lintRequest, semanticRequest.IndexGeneration)
	case ProjectSemanticBackground:
		var err error
		lintRequest := projectLintIndexRequest(root, configPath, projectName, index, astResult.UsedStaticIndex)
		if err := applyProjectLintPrefetch(&lintRequest, lintPrefetch); err != nil {
			return store.IndexData{}, err
		}
		index, err = s.applyProjectLintPatch(ctx, lintRequest, semanticRequest.IndexGeneration)
		if err != nil {
			return store.IndexData{}, err
		}
		if plannedSemantic != nil {
			plannedSemanticDetached = true
			s.applyPlannedProjectSemanticPatchInBackground(semanticRequest, plannedSemantic, index)
		} else {
			s.applyProjectSemanticPatchInBackground(semanticRequest)
		}
		return index, nil
	default:
		index, err = s.applyPlannedProjectSemanticPatch(ctx, semanticRequest, plannedSemantic, lintPrefetch, index)
		if err != nil {
			return store.IndexData{}, err
		}
	}
	return index, nil
}
