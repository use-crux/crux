package service

import (
	"context"
	"fmt"
	"path/filepath"
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
	if containsProjectConfigChange(
		root,
		configPath,
		previous,
		files,
		deletedFiles,
	) {
		s.watchStatus.FullFallback(
			options.Watch,
			files,
			deletedFiles,
			"config-changed",
		)
		return p.reindexProjectWithOptions(
			ctx,
			root,
			configPath,
			projectName,
			options,
		)
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

	applyPatch := s.commitAndApply
	if options.hasWatchRun() {
		applyPatch = s.commitAndApplyRaw
	}
	index := previous
	for _, patch := range result.Patches {
		index, err = applyPatch(ctx, normalizePatchIdentity(patch, root, configPath, projectName))
		if err != nil {
			return store.IndexData{}, err
		}
	}
	run.index = index
	run.astUsedStaticIndex = result.Report.ASTUsedStaticIndex

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
	run.semanticRequest.ASTUsedStaticIndex = result.Report.ASTUsedStaticIndex
	run.generation = run.semanticRequest.IndexGeneration

	run.lintPrefetch = s.startProjectLintPrefetch(ctx, projectLintIndexRequest(root, configPath, projectName, index, result.Report.ASTUsedStaticIndex))
	defer func() {
		if !run.lintPrefetchDetached {
			run.lintPrefetch.stop()
		}
	}()

	s.watchStatus.IncrementalResult(options.Watch, result, len(result.Patches), watchSemanticStatusForMode(semanticMode))

	return s.completeSemanticAndLint(ctx, run)
}

func containsProjectConfigChange(
	root string,
	configPath string,
	previous store.IndexData,
	files []string,
	deletedFiles []string,
) bool {
	candidates := []string{configPath}
	if previous.Project != nil {
		candidates = append(candidates, previous.Project.ConfigFile)
	}
	for _, changed := range append(
		append([]string(nil), files...),
		deletedFiles...,
	) {
		if isCruxConfigFile(changed) {
			return true
		}
		for _, candidate := range candidates {
			if candidate != "" &&
				projectPath(root, changed) == projectPath(root, candidate) {
				return true
			}
		}
	}
	return false
}

func isCruxConfigFile(path string) bool {
	switch filepath.Base(path) {
	case "crux.config.cjs",
		"crux.config.cts",
		"crux.config.js",
		"crux.config.mjs",
		"crux.config.mts",
		"crux.config.ts":
		return true
	default:
		return false
	}
}

func projectPath(root string, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Join(root, path))
}
