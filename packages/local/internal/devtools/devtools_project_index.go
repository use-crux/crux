package devtools

import (
	"context"
	"fmt"
	"strings"
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
	s.indexPatch = emptyIndexPatchState()
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
	switch options.semanticMode() {
	case ProjectSemanticDisabled:
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
	if !ok || isEmptyIndex(previous) || len(previous.Sources) == 0 || !hasCompleteProjectShardEvidence(previous) {
		return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultProjectIndexReindexTimeout)
		defer cancel()
	}
	if isEmptyIndex(s.indexPatch.Index) {
		s.indexPatch = applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(previous, indexPatchPhaseCache, "ok"))
	}
	result, err := indexer.IndexProjectIncremental(ctx, root, configPath, projectName, previous, files, deletedFiles, "ast")
	if err != nil {
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
	switch options.semanticMode() {
	case ProjectSemanticDisabled:
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

func hasCompleteProjectShardEvidence(index store.IndexData) bool {
	if index.SourceGraph == nil || !stringSliceContains(index.SourceGraph.Capabilities, "project-shards") || len(index.SourceGraph.Shards) == 0 {
		return false
	}
	for _, source := range index.Sources {
		if source.File == "" {
			continue
		}
		if source.ShardID != "" {
			continue
		}
		if shardIDForSourceFile(source.File, index.SourceGraph.Shards) == "" {
			return false
		}
	}
	return true
}

func shardIDForSourceFile(file string, shards []store.ProjectIndexShard) string {
	bestID := ""
	bestRootLen := -1
	for _, shard := range shards {
		if shard.Root == "" {
			continue
		}
		if file == shard.Root || strings.HasPrefix(file, shard.Root+"/") {
			if len(shard.Root) > bestRootLen {
				bestID = shard.ID
				bestRootLen = len(shard.Root)
			}
		}
	}
	return bestID
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

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
		return s.applyProjectSemanticDegradedPatch(ctx, request.Root, request.ConfigPath, request.ProjectName, semanticStartedAt, "index.semantic_degraded", err.Error())
	}
	if err := validateIndexPatchBudget(patch, request.Budget); err != nil {
		return s.applyProjectSemanticDegradedPatch(ctx, request.Root, request.ConfigPath, request.ProjectName, semanticStartedAt, "index.semantic_budget_exceeded", err.Error())
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
	clearsSourceOnly := hasSourceOnlyDiagnostic(s.store.GetIndex().Diagnostics) && (patch.Status == "" || patch.Status == "ok")
	indexing := store.IndexIndexingWithSemanticReady(
		s.store.GetIndex().Indexing,
		patch.FinishedAt,
		time.Since(semanticStartedAt),
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
		return store.IndexData{}, err
	}
	return s.ApplyIndexPatch(ctx, patch), nil
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

func (s *Service) applyProjectSemanticDegradedPatch(ctx context.Context, root, configPath, projectName string, startedAt time.Time, code string, message string) (store.IndexData, error) {
	current := s.store.GetIndex()
	project := store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
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
	if err := s.commitIndexPatch(ctx, patch); err != nil {
		return store.IndexData{}, err
	}
	return s.ApplyIndexPatch(ctx, patch), nil
}

func (s *Service) loadIndexFactCache(ctx context.Context, root, projectName string, loadedAt time.Time) (store.IndexData, bool) {
	if s.factStore == nil {
		return store.IndexData{}, false
	}
	index, ok, err := s.factStore.LoadSnapshot(ctx, root, projectName, loadedAt)
	if err != nil {
		return store.IndexData{}, false
	}
	return index, ok
}

func (s *Service) commitIndexPatch(ctx context.Context, patch IndexPatch) error {
	if s.factStore == nil {
		return nil
	}
	if err := s.factStore.CommitPhase(ctx, indexFactTransactionFromPatch(patch)); err != nil {
		// Cache writes must not make source indexing fail for fake, read-only,
		// or otherwise unwritable project roots. Direct FactStore calls remain
		// strict and are covered by transaction-level tests.
		return nil
	}
	return nil
}
