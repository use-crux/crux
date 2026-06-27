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

	run := &refreshRun{
		root:          root,
		configPath:    configPath,
		projectName:   projectName,
		startedAt:     time.Now(),
		watch:         options.Watch,
		semanticMode:  semanticMode,
		semanticMatch: projectSemanticRequestScopeMatches,
		previous:      previous,
	}
	if semanticMode == ProjectSemanticInline {
		run.plannedSemantic = s.startPlannedProjectIncrementalSemanticPatch(ctx, semanticMode, root, configPath, projectName, previous, files, deletedFiles)
	}
	defer func() {
		if !run.plannedSemanticDetached {
			run.plannedSemantic.stop()
		}
	}()

	s.indexMu.Lock()
	if projectindex.IsEmptyIndex(s.indexState.Index()) {
		s.indexState.Hydrate(previous, projectindex.PhaseCache, "ok")
	}
	s.indexMu.Unlock()

	result, err := indexer.IndexProjectIncremental(ctx, root, configPath, projectName, previous, files, deletedFiles, "ast")
	if err != nil {
		run.plannedSemantic.stop()
		s.watchStatus.FullFallback(options.Watch, files, deletedFiles, "incremental-worker-error")
		return p.reindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}

	index := previous
	for _, patch := range result.Patches {
		index, err = s.commitAndApply(ctx, normalizePatchIdentity(patch, root, configPath, projectName))
		if err != nil {
			return store.IndexData{}, err
		}
	}
	run.index = index

	run.semanticRequest = projectSemanticIndexRequest(
		root,
		configPath,
		projectName,
		index,
		result.Report.AffectedFiles,
		semanticSourceProfileFromPatches(result.Patches),
	)
	run.semanticRequest.IndexGeneration = s.indexState.CurrentGeneration()
	run.semanticRequest.WatchRunID = options.Watch.RunID
	run.generation = run.semanticRequest.IndexGeneration

	run.lintPrefetch = s.startProjectLintPrefetch(ctx, projectLintIndexRequest(root, configPath, projectName, index, false))
	defer run.lintPrefetch.stop()

	s.watchStatus.IncrementalResult(options.Watch, result, len(result.Patches), watchSemanticStatusForMode(semanticMode))

	return s.completeSemanticAndLint(ctx, run)
}
