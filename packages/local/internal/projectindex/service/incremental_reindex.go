package service

import (
	"context"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (p projectIndexPipeline) reindexProjectIncrementalWithOptions(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	files []string,
	deletedFiles []string,
	options ProjectReindexOptions,
) (store.IndexData, error) {
	s := p.service
	if s.indexer == nil {
		return store.IndexData{}, fmt.Errorf("project index indexer is not configured")
	}
	indexer, ok := s.indexer.(IncrementalClient)
	previous := s.store.GetIndex()
	if options.hasWatchRun() {
		s.watchStatus.Start(options.Watch, files, deletedFiles)
	}
	if !ok {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-incremental-worker")
		return p.reindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if projectindex.IsEmptyIndex(previous) || len(previous.Sources) == 0 {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-previous-source-graph")
		return p.reindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if !projectindex.HasCompleteShardEvidence(previous) {
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "missing-shard-evidence")
		return p.reindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	ctx, cancel := projectReindexContext(ctx)
	defer cancel()

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
		return p.reindexProjectWithOptions(ctx, root, configPath, projectName, options)
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
