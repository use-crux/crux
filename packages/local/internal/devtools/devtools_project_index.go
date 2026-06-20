package devtools

import (
	"context"
	"fmt"
	"time"

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
	startedAt := time.Now()
	s.indexMu.Lock()
	s.indexPatch = emptyIndexPatchState()
	s.indexMu.Unlock()
	cacheLoaded := false
	if cached, ok := s.loadIndexFactCache(ctx, root, projectName, startedAt); ok {
		cacheLoaded = true
		s.ApplyIndexPatch(ctx, indexPatchFromSnapshot(cached, indexPatchPhaseCache, "ok"))
	}
	patch, err := s.indexer.IndexProjectAstPatch(ctx, root, configPath, projectName)
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
	if patch.Phase == "" {
		patch.Phase = indexPatchPhaseAST
	}
	if patch.Project.Root == "" {
		patch.Project = store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
	}
	if patch.FinishedAt == "" {
		patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	patch.Indexing = store.ReadyIndexIndexingStatus(patch.FinishedAt, time.Since(startedAt), len(patch.Facts.Sources), len(patch.Facts.Diagnostics), hasSourceOnlyDiagnostic(patch.Facts.Diagnostics))
	if cacheLoaded && patch.Indexing.Cache != nil {
		patch.Indexing.Cache.Status = "hit"
		patch.Indexing.Cache.LoadedAt = startedAt.UTC().Format(time.RFC3339Nano)
	}
	if err := s.commitIndexPatch(ctx, patch); err != nil {
		return store.IndexData{}, err
	}
	index := s.ApplyIndexPatch(ctx, patch)
	semanticRequest := projectSemanticIndexRequest(root, configPath, projectName, index, nil, patch.SemanticSourceProfile)
	semanticRequest.IndexGeneration = s.indexGeneration.Current()
	semanticRequest.WatchRunID = options.Watch.RunID
	switch options.semanticMode() {
	case ProjectSemanticDisabled:
		s.watchStatus.SemanticDisabled(options.Watch.RunID)
		return index, nil
	case ProjectSemanticBackground:
		s.applyProjectSemanticPatchInBackground(semanticRequest)
		return index, nil
	default:
		index, err = s.applyProjectSemanticPatch(ctx, semanticRequest)
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
	indexer, ok := s.indexer.(ProjectIncrementalIndexer)
	previous := s.store.GetIndex()
	if options.hasWatchRun() {
		s.watchStatus.Start(options.Watch, files, deletedFiles)
	}
	if !ok {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-incremental-worker")
		return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if isEmptyIndex(previous) || len(previous.Sources) == 0 {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-previous-source-graph")
		return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if !hasCompleteProjectShardEvidence(previous) {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-shard-evidence")
		return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultProjectIndexReindexTimeout)
		defer cancel()
	}
	s.indexMu.Lock()
	if isEmptyIndex(s.indexPatch.Index) {
		s.indexPatch = applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(previous, indexPatchPhaseCache, "ok"))
	}
	s.indexMu.Unlock()
	result, err := indexer.IndexProjectIncremental(ctx, root, configPath, projectName, previous, files, deletedFiles, "ast")
	if err != nil {
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
		if err := s.commitIndexPatch(ctx, patch); err != nil {
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
	semanticRequest.IndexGeneration = s.indexGeneration.Current()
	semanticRequest.WatchRunID = options.Watch.RunID
	s.watchStatus.IncrementalResult(options.Watch, result, len(result.Patches), watchSemanticStatusForMode(options.semanticMode()))
	switch options.semanticMode() {
	case ProjectSemanticDisabled:
		s.watchStatus.SemanticDisabled(options.Watch.RunID)
		return index, nil
	case ProjectSemanticBackground:
		s.applyProjectSemanticPatchInBackground(semanticRequest)
	default:
		index, err = s.applyProjectSemanticPatch(ctx, semanticRequest)
		if err != nil {
			return store.IndexData{}, err
		}
	}
	return index, nil
}
