package devtools

import (
	"context"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) ReindexProject(ctx context.Context, root, configPath, projectName string) (store.IndexData, error) {
	return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, ProjectReindexOptions{})
}

func (s *Service) ReindexProjectWithOptions(ctx context.Context, root, configPath, projectName string, options ProjectReindexOptions) (store.IndexData, error) {
	if s.indexer == nil {
		return store.IndexData{}, fmt.Errorf("project index indexer is not configured")
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultProjectIndexReindexTimeout)
		defer cancel()
	}
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
		s.indexEvents.Publish(s.indexReadModel())
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
	patch.Indexing = store.ReadyIndexIndexingStatus(patch.FinishedAt, time.Since(startedAt), len(patch.Facts.Sources), len(patch.Facts.Diagnostics), projectindex.HasSourceOnlyDiagnostic(patch.Facts.Diagnostics))
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
	semanticRequest.ASTUsedNativeStatic = astResult.UsedNativeStatic
	lintPrefetch := s.startProjectLintPrefetch(ctx, projectLintIndexRequest(root, configPath, projectName, index, astResult.UsedNativeStatic))
	defer lintPrefetch.stop()
	switch semanticMode {
	case ProjectSemanticDisabled:
		s.watchStatus.SemanticDisabled(options.Watch.RunID)
		lintRequest := projectLintIndexRequest(root, configPath, projectName, index, astResult.UsedNativeStatic)
		if err := applyProjectLintPrefetch(&lintRequest, lintPrefetch); err != nil {
			return store.IndexData{}, err
		}
		return s.applyProjectLintPatch(ctx, lintRequest, semanticRequest.IndexGeneration)
	case ProjectSemanticBackground:
		var err error
		lintRequest := projectLintIndexRequest(root, configPath, projectName, index, astResult.UsedNativeStatic)
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

func (s *Service) ReindexProjectIncremental(ctx context.Context, root, configPath, projectName string, files []string, deletedFiles []string) (store.IndexData, error) {
	return s.ReindexProjectIncrementalWithOptions(ctx, root, configPath, projectName, files, deletedFiles, ProjectReindexOptions{})
}

func (s *Service) ReindexProjectIncrementalWithOptions(ctx context.Context, root, configPath, projectName string, files []string, deletedFiles []string, options ProjectReindexOptions) (store.IndexData, error) {
	if s.indexer == nil {
		return store.IndexData{}, fmt.Errorf("project index indexer is not configured")
	}
	indexer, ok := s.indexer.(projectindex.ProjectIncrementalIndexer)
	previous := s.store.GetIndex()
	if options.hasWatchRun() {
		s.watchStatus.Start(options.Watch, files, deletedFiles)
	}
	if !ok {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-incremental-worker")
		return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if projectindex.IsEmptyIndex(previous) || len(previous.Sources) == 0 {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-previous-source-graph")
		return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if !projectindex.HasCompleteShardEvidence(previous) {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-shard-evidence")
		return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultProjectIndexReindexTimeout)
		defer cancel()
	}
	semanticMode := options.semanticMode()
	s.startProjectSemanticPrewarm(ctx, semanticMode)
	var plannedSemantic *projectSemanticPatchTask
	if semanticMode == ProjectSemanticInline {
		plannedSemantic = s.startPlannedProjectIncrementalSemanticPatch(ctx, semanticMode, root, configPath, projectName, previous, files, deletedFiles)
	}
	plannedSemanticDetached := false
	defer func() {
		if !plannedSemanticDetached {
			plannedSemantic.stop()
		}
	}()
	s.indexMu.Lock()
	if projectindex.IsEmptyIndex(s.indexState.Index()) {
		s.indexState.Hydrate(previous, projectindex.PhaseCache, "ok")
	}
	s.indexMu.Unlock()
	result, err := indexer.IndexProjectIncremental(ctx, root, configPath, projectName, previous, files, deletedFiles, "ast")
	if err != nil {
		plannedSemantic.stop()
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "incremental-worker-error")
		return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	index := previous
	for _, patch := range result.Patches {
		if patch.Project.Root == "" {
			patch.Project = store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
		}
		if patch.FinishedAt == "" {
			patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
		}
		if err := s.indexCache.Commit(ctx, patch); err != nil {
			return store.IndexData{}, err
		}
		index = s.ApplyIndexPatch(ctx, patch)
	}
	semanticRequest := projectSemanticIndexRequest(
		root,
		configPath,
		projectName,
		index,
		result.Report.AffectedFiles,
		semanticSourceProfileFromPatches(result.Patches),
	)
	semanticRequest.IndexGeneration = s.indexState.CurrentGeneration()
	semanticRequest.WatchRunID = options.Watch.RunID
	lintPrefetch := s.startProjectLintPrefetch(ctx, projectLintIndexRequest(root, configPath, projectName, index, false))
	defer lintPrefetch.stop()
	s.watchStatus.IncrementalResult(options.Watch, result, len(result.Patches), watchSemanticStatusForMode(semanticMode))
	switch semanticMode {
	case ProjectSemanticDisabled:
		s.watchStatus.SemanticDisabled(options.Watch.RunID)
		lintRequest := projectLintIndexRequest(root, configPath, projectName, index, false)
		if err := applyProjectLintPrefetch(&lintRequest, lintPrefetch); err != nil {
			return store.IndexData{}, err
		}
		return s.applyProjectLintPatch(ctx, lintRequest, semanticRequest.IndexGeneration)
	case ProjectSemanticBackground:
		var err error
		lintRequest := projectLintIndexRequest(root, configPath, projectName, index, false)
		if err := applyProjectLintPrefetch(&lintRequest, lintPrefetch); err != nil {
			return store.IndexData{}, err
		}
		index, err = s.applyProjectLintPatch(ctx, lintRequest, semanticRequest.IndexGeneration)
		if err != nil {
			return store.IndexData{}, err
		}
		if plannedSemantic != nil {
			plannedSemanticDetached = true
			s.applyPlannedProjectIncrementalSemanticPatchInBackground(semanticRequest, plannedSemantic, index)
		} else {
			s.applyProjectSemanticPatchInBackground(semanticRequest)
		}
	default:
		index, err = s.applyPlannedProjectIncrementalSemanticPatch(ctx, semanticRequest, plannedSemantic, lintPrefetch, index)
		if err != nil {
			return store.IndexData{}, err
		}
	}
	return index, nil
}
