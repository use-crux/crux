package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ProjectIndexer owns source discovery for the Project Index.
type ProjectIndexer interface {
	IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string, staticOnly bool) (IndexPatch, error)
}

type ProjectSemanticIndexer interface {
	IndexProjectSemanticPatch(ctx context.Context, root, configPath, projectName string, budget IndexPatchBudget) (IndexPatch, error)
}

type ProjectIncrementalIndexer interface {
	IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (ProjectIndexIncrementalResult, error)
}

type ResourceInspector interface {
	List(context.Context, resourceinspection.ListRequest) (resourceinspection.ResourceResult, error)
}

type Service struct {
	ctx           context.Context
	cancel        context.CancelFunc
	store         *store.Store
	quality       *quality.Service
	observability *observability.Service
	resources     ResourceInspector
	indexEvents   *IndexEventBus
	indexer       ProjectIndexer
	indexPatch    indexPatchState
}

const defaultProjectIndexReindexTimeout = 120 * time.Second

var projectIndexSemanticTimeout = 30 * time.Second

var projectIndexSemanticBudget = IndexPatchBudget{
	MaxFiles:        5000,
	MaxDefinitions:  2500,
	MaxRelations:    10000,
	MaxSourceRefs:   20000,
	MaxDiagnostics:  250,
	MaxLintFindings: 1000,
	MaxSources:      10000,
	MaxBytes:        8 * 1024 * 1024,
}

func NewService(s *store.Store, qualitySvc *quality.Service) *Service {
	if qualitySvc == nil {
		qualitySvc = quality.NewService(s, quality.Dir(""))
	}
	ctx, cancel := context.WithCancel(context.Background())
	service := &Service{
		ctx:         ctx,
		cancel:      cancel,
		store:       s,
		quality:     qualitySvc,
		indexEvents: NewIndexEventBus(),
		indexPatch:  emptyIndexPatchState(),
	}
	service.startIndexChangePublisher()
	return service
}

func (s *Service) WithObservability(service *observability.Service) *Service {
	s.observability = service
	if service != nil {
		s.quality.WithObservability(service)
	}
	return s
}

func (s *Service) WithResourceInspection(inspector ResourceInspector) *Service {
	s.resources = inspector
	return s
}

func (s *Service) WithProjectIndexer(indexer ProjectIndexer) *Service {
	s.indexer = indexer
	return s
}

func (s *Service) startIndexChangePublisher() {
	changes := s.store.Subscribe()
	go func() {
		var timer *time.Timer
		var timerC <-chan time.Time
		for {
			select {
			case <-s.ctx.Done():
				if timer != nil {
					timer.Stop()
				}
				return
			case <-changes:
				if timer == nil {
					timer = time.NewTimer(100 * time.Millisecond)
					timerC = timer.C
					continue
				}
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(100 * time.Millisecond)
			case <-timerC:
				s.indexEvents.Publish(s.indexReadModel())
				timer = nil
				timerC = nil
			}
		}
	}()
}

func (s *Service) Shutdown() {
	s.cancel()
}

func (s *Service) Quality() *quality.Service {
	return s.quality
}

func (s *Service) IndexEvents() *IndexEventBus {
	return s.indexEvents
}

func (s *Service) SubscribeChanges() <-chan struct{} {
	return s.store.Subscribe()
}

func (s *Service) RegisterIndexSnapshot(_ context.Context, index store.IndexData) {
	s.store.SetIndexData(mergeRuntimeIndexSnapshot(s.store.GetIndex(), index))
	s.indexEvents.Publish(s.indexReadModel())
}

func (s *Service) ApplyIndexPatch(_ context.Context, patch IndexPatch) store.IndexData {
	s.indexPatch = applyIndexPatch(s.indexPatch, patch)
	s.store.SetIndexData(s.indexPatch.Index)
	index := s.indexReadModel()
	s.indexEvents.Publish(index)
	return index
}

func (s *Service) ReindexProject(ctx context.Context, root, configPath, projectName string) (store.IndexData, error) {
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
	if cached, ok := loadIndexCache(root, projectName, startedAt); ok {
		cacheLoaded = true
		s.ApplyIndexPatch(ctx, indexPatchFromSnapshot(cached, indexPatchPhaseCache, "ok"))
	}
	patch, err := s.indexer.IndexProjectAstPatch(ctx, root, configPath, projectName, true)
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
	patch.Indexing = store.ReadyIndexIndexingStatus(patch.FinishedAt, time.Since(startedAt), len(patch.Facts.Sources), len(patch.Facts.Diagnostics), hasStaticOnlyDiagnostic(patch.Facts.Diagnostics))
	if cacheLoaded && patch.Indexing.Cache != nil {
		patch.Indexing.Cache.Status = "hit"
		patch.Indexing.Cache.LoadedAt = startedAt.UTC().Format(time.RFC3339Nano)
	}
	index := s.ApplyIndexPatch(ctx, patch)
	index = s.applyProjectSemanticPatch(ctx, root, configPath, projectName)
	writeIndexCache(root, s.store.GetIndex())
	return index, nil
}

func (s *Service) ReindexProjectIncremental(ctx context.Context, root, configPath, projectName string, files []string, deletedFiles []string) (store.IndexData, error) {
	if s.indexer == nil {
		return store.IndexData{}, fmt.Errorf("project index indexer is not configured")
	}
	indexer, ok := s.indexer.(ProjectIncrementalIndexer)
	previous := s.store.GetIndex()
	if !ok || isEmptyIndex(previous) || len(previous.Sources) == 0 {
		return s.ReindexProject(ctx, root, configPath, projectName)
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultProjectIndexReindexTimeout)
		defer cancel()
	}
	if isEmptyIndex(s.indexPatch.Index) {
		s.indexPatch = applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(previous, indexPatchPhaseCache, "ok"))
	}
	result, err := indexer.IndexProjectIncremental(ctx, root, configPath, projectName, previous, files, deletedFiles, "ast-and-semantic")
	if err != nil {
		return s.ReindexProject(ctx, root, configPath, projectName)
	}
	index := previous
	for _, patch := range result.Patches {
		if patch.Project.Root == "" {
			patch.Project = store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
		}
		if patch.FinishedAt == "" {
			patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
		}
		index = s.ApplyIndexPatch(ctx, patch)
	}
	writeIndexCache(root, s.store.GetIndex())
	return index, nil
}

func (s *Service) applyProjectSemanticPatch(ctx context.Context, root, configPath, projectName string) store.IndexData {
	indexer, ok := s.indexer.(ProjectSemanticIndexer)
	if !ok {
		return s.indexReadModel()
	}
	semanticStartedAt := time.Now()
	semanticCtx, cancel := context.WithTimeout(ctx, projectIndexSemanticTimeout)
	defer cancel()
	patch, err := indexer.IndexProjectSemanticPatch(semanticCtx, root, configPath, projectName, projectIndexSemanticBudget)
	if err != nil {
		return s.applyProjectSemanticDegradedPatch(ctx, root, configPath, projectName, semanticStartedAt, "index.semantic_degraded", err.Error())
	}
	if err := validateIndexPatchBudget(patch, projectIndexSemanticBudget); err != nil {
		return s.applyProjectSemanticDegradedPatch(ctx, root, configPath, projectName, semanticStartedAt, "index.semantic_budget_exceeded", err.Error())
	}
	if patch.Phase == "" {
		patch.Phase = indexPatchPhaseSemantic
	}
	if patch.Project.Root == "" {
		patch.Project = store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
	}
	if patch.FinishedAt == "" {
		patch.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	clearsStaticOnly := hasOnlyStaticOnlyDiagnostics(s.store.GetIndex().Diagnostics) && len(patch.Facts.Diagnostics) == 0 && (patch.Status == "" || patch.Status == "ok")
	indexing := store.IndexIndexingWithSemanticReady(
		s.store.GetIndex().Indexing,
		patch.FinishedAt,
		time.Since(semanticStartedAt),
		len(patch.Facts.Diagnostics),
		len(patch.Facts.Definitions),
	)
	if clearsStaticOnly {
		indexing.Status = "ready"
		indexing.Error = ""
		if indexing.AST.Status == "degraded" {
			indexing.AST.Status = "ready"
			indexing.AST.DiagnosticCount = 0
		}
		s.indexPatch.DiagnosticsByPhase[indexPatchPhaseAST] = filterRuntimeIndexDiagnostics(s.indexPatch.DiagnosticsByPhase[indexPatchPhaseAST])
	}
	patch.Indexing = indexing
	return s.ApplyIndexPatch(ctx, patch)
}

func (s *Service) applyProjectSemanticDegradedPatch(ctx context.Context, root, configPath, projectName string, startedAt time.Time, code string, message string) store.IndexData {
	current := s.store.GetIndex()
	project := store.ProjectIdentity{Root: root, Name: projectName, ConfigFile: configPath}
	if current.Project != nil {
		project = *current.Project
	}
	finishedAt := time.Now().UTC().Format(time.RFC3339Nano)
	return s.ApplyIndexPatch(ctx, IndexPatch{
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
	})
}

func (s *Service) Get(ctx context.Context, path string, query url.Values) (any, bool, error) {
	if route, q, ok := strings.Cut(path, "?"); ok {
		path = route
		if query == nil {
			parsed, _ := url.ParseQuery(q)
			query = parsed
		}
	}
	if query == nil {
		query = url.Values{}
	}

	switch path {
	case "/api/index":
		return s.indexReadModel(), true, nil
	case "/api/project/index":
		return s.indexReadModel(), true, nil
	case "/api/memory/stores":
		stores, err := s.memoryStores(ctx)
		return stores, true, err
	case "/api/memory/operations":
		operations, err := s.memoryOperations(ctx, queryInt64Value(query, "since", 0), queryInt64Value(query, "until", 0), queryIntValue(query, "limit", 50))
		return operations, true, err
	case "/api/workspaces":
		workspaces, err := s.workspaceSummaries(ctx)
		return workspaces, true, err
	case "/api/plans":
		plans, err := s.plans(ctx)
		return plans, true, err
	case "/api/evals":
		return s.store.GetEvalRuns(), true, nil
	case "/api/rag-evals":
		return s.store.GetRagEvalRuns(), true, nil
	case "/api/flows":
		return s.store.GetFlowRuns(), true, nil
	case "/api/runtime-flows":
		return s.store.GetRuntimeFlowRuns(), true, nil
	case "/api/stats":
		if s.observability != nil {
			return observabilityStats(ctx, s.observability), true, nil
		}
		return s.store.GetStats(), true, nil
	case "/api/stats/timeseries":
		if s.observability != nil {
			return observabilityTimeseries(ctx, s.observability, queryIntValue(query, "buckets", 20)), true, nil
		}
		return s.store.GetTimeseries(queryIntValue(query, "buckets", 20)), true, nil
	case "/api/stats/baselines":
		if s.observability != nil {
			return observabilityPromptBaselines(ctx, s.observability, queryIntValue(query, "window", 0)), true, nil
		}
		return s.store.GetPromptBaselines(queryIntValue(query, "window", 0)), true, nil
	case "/api/stats/prompt-usage":
		if s.observability != nil {
			return observabilityPromptUsage(ctx, s.observability), true, nil
		}
		return s.store.GetPromptUsageStats(), true, nil
	case "/api/stats/dropped-contexts":
		if s.observability != nil {
			return observabilityDroppedContexts(ctx, s.observability), true, nil
		}
		return s.store.GetDroppedContextFrequency(), true, nil
	case "/api/stats/judge-timeseries":
		return s.store.GetJudgeTimeseries(queryIntValue(query, "buckets", 20)), true, nil
	case "/api/memory":
		return s.store.GetMemoryEvents(), true, nil
	case "/api/embedding":
		return s.store.GetEmbeddingEvents(), true, nil
	case "/api/retrieval":
		return s.store.GetRetrievalEvents(), true, nil
	case "/api/retrieval-stages":
		return s.store.GetRetrievalStageEvents(), true, nil
	case "/api/workspace":
		return s.store.GetWorkspaceEvents(), true, nil
	case "/api/index/events":
		return s.store.GetIndexEvents(), true, nil
	case "/api/memory/instances":
		return s.store.GetMemoryInstances(), true, nil
	case "/api/compaction":
		return s.store.GetCompactEvents(), true, nil
	case "/api/budget":
		return s.store.GetBudgetSnapshots(), true, nil
	case "/api/cost":
		return s.store.GetCostEvents(), true, nil
	case "/api/corpus":
		return s.store.GetCorpusEvents(), true, nil
	case "/api/ingest":
		return s.store.GetIngestEvents(), true, nil
	case "/api/agent":
		return s.store.GetAgentEvents(), true, nil
	case "/api/compositions/stats":
		return s.store.GetCompositionStats(), true, nil
	case "/api/judges":
		return s.store.GetJudgeEvents(), true, nil
	case "/api/delegates":
		return s.store.GetDelegateEvents(), true, nil
	case "/api/tools/events":
		return s.store.GetToolEvents(), true, nil
	case "/api/security/events":
		return s.store.GetSecurityEvents(), true, nil
	case "/api/security/by-prompt":
		return s.store.GetSecurityByPrompt(), true, nil
	case "/api/plans/events":
		return s.store.GetPlanEvents(), true, nil
	case "/api/tasklists":
		return s.store.GetTaskListEvents(), true, nil
	case "/api/tasks":
		return s.store.GetTaskEvents(), true, nil
	case "/api/guardrails":
		return s.store.GetGuardrailRuns(), true, nil
	case "/api/constraints":
		return map[string]any{
			"checks":     s.store.GetConstraintChecks(),
			"retries":    s.store.GetConstraintRetries(),
			"violations": s.store.GetConstraintViolations(),
		}, true, nil
	case "/api/timeline":
		if s.observability != nil {
			return observabilityTimeline(ctx, s.observability, query.Get("session")), true, nil
		}
		return s.store.GetAllEvents(query.Get("session")), true, nil
	case "/api/sessions":
		if s.observability != nil {
			return observabilitySessions(ctx, s.observability), true, nil
		}
		return s.store.GetSessions(), true, nil
	case "/api/devtools/context":
		return s.Context(), true, nil
	}

	if storeID, ok := strings.CutPrefix(path, "/api/memory/stores/"); ok {
		detail, found, err := s.memoryStoreDetail(ctx, decodePathSegment(storeID))
		return detail, found, err
	}
	if rest, ok := strings.CutPrefix(path, "/api/workspaces/"); ok {
		parts := strings.Split(rest, "/")
		workspaceID := decodePathSegment(parts[0])
		if len(parts) >= 3 && parts[1] == "files" {
			filePath := decodePathSegment(strings.Join(parts[2:], "/"))
			if strings.HasSuffix(filePath, "/diff") {
				return nil, false, nil
			}
			detail, found, err := s.workspaceFileDetail(ctx, workspaceID, filePath)
			return detail, found, err
		}
		detail, found, err := s.workspaceDetail(ctx, workspaceID)
		return detail, found, err
	}
	if rest, ok := strings.CutPrefix(path, "/api/plans/"); ok {
		planID, suffix, hasSuffix := strings.Cut(rest, "/")
		planID = decodePathSegment(planID)
		if hasSuffix && suffix == "diff" {
			return nil, false, nil
		}
		detail, found := s.planDetail(ctx, planID)
		return detail, found, nil
	}

	if evalID, ok := strings.CutPrefix(path, "/api/evals/baseline/"); ok {
		baseline := s.store.GetEvalBaseline(evalID)
		if baseline == nil {
			return nil, false, nil
		}
		return baseline, true, nil
	}
	if evalID, ok := strings.CutPrefix(path, "/api/evals/"); ok {
		run := s.store.GetEvalRun(evalID)
		if run == nil {
			return nil, false, nil
		}
		return run, true, nil
	}
	if evalID, ok := strings.CutPrefix(path, "/api/rag-evals/"); ok {
		run := s.store.GetRagEvalRun(evalID)
		if run == nil {
			return nil, false, nil
		}
		return run, true, nil
	}
	if flowID, ok := strings.CutPrefix(path, "/api/flows/"); ok {
		run := s.store.GetFlowRun(flowID)
		if run == nil {
			return nil, false, nil
		}
		return run, true, nil
	}
	if memoryID, ok := strings.CutPrefix(path, "/api/memory/instances/"); ok {
		instance := s.store.GetMemoryInstance(memoryID)
		if instance == nil {
			return nil, false, nil
		}
		return instance, true, nil
	}

	return nil, false, fmt.Errorf("unsupported devtools route %q", path)
}

func (s *Service) indexReadModel() store.IndexData {
	index := s.store.GetIndex()
	if s.quality != nil {
		index = s.quality.EnrichIndex(index)
	}
	index = enrichIndexDefinitionUpdated(index)
	return enrichIndexSafetyTargets(index)
}

func enrichIndexDefinitionUpdated(index store.IndexData) store.IndexData {
	if len(index.Definitions) == 0 {
		return index
	}
	root := ""
	if index.Project != nil {
		root = index.Project.Root
	}
	definitions := make([]store.ProjectDefinition, len(index.Definitions))
	copy(definitions, index.Definitions)
	for i := range definitions {
		source := definitions[i].Source
		if source == nil || source.File == "" {
			continue
		}
		sourceFile := source.File
		if !filepath.IsAbs(sourceFile) && root != "" {
			sourceFile = filepath.Join(root, sourceFile)
		}
		info, err := os.Stat(sourceFile)
		if err != nil || info.IsDir() {
			continue
		}
		definitions[i].Metadata = mergeMetadataRaw(definitions[i].Metadata, mustMarshalJSON(map[string]any{
			"updated": map[string]any{
				"lastEditedAt":   info.ModTime().UTC().Format(time.RFC3339Nano),
				"lastEditedAtMs": info.ModTime().UnixMilli(),
				"sourceMtime":    true,
			},
		}))
	}
	index.Definitions = definitions
	return index
}

func enrichIndexSafetyTargets(index store.IndexData) store.IndexData {
	if len(index.Definitions) == 0 || len(index.Relations) == 0 {
		return index
	}
	targetsBySafetyID := map[string][]string{}
	for _, relation := range index.Relations {
		if relation.Type != "constraint.applies_to" && relation.Type != "guardrail.applies_to" {
			continue
		}
		if relation.From == "" || relation.To == "" {
			continue
		}
		targetsBySafetyID[relation.From] = appendUniqueString(targetsBySafetyID[relation.From], relation.To)
	}
	if len(targetsBySafetyID) == 0 {
		return index
	}
	definitions := make([]store.ProjectDefinition, len(index.Definitions))
	copy(definitions, index.Definitions)
	for i := range definitions {
		targets := targetsBySafetyID[definitions[i].ID]
		if len(targets) == 0 {
			continue
		}
		metadata := rawMap(definitions[i].Metadata)
		facts := rawMapAny(metadata["facts"])
		if len(facts) == 0 {
			facts = map[string]any{"kind": definitions[i].Kind}
		}
		facts["appliesTo"] = targets
		metadata["appliesTo"] = targets
		metadata["facts"] = facts
		definitions[i].Metadata = mustMarshalJSON(metadata)
	}
	index.Definitions = definitions
	return index
}

func appendUniqueString(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func rawMapAny(value any) map[string]any {
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func mustMarshalJSON(value any) json.RawMessage {
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return data
}

func mergeRuntimeIndexSnapshot(current, incoming store.IndexData) store.IndexData {
	if isEmptyIndex(current) {
		incoming.Diagnostics = filterRuntimeIndexDiagnostics(incoming.Diagnostics)
		return normalizeRuntimeIndexSnapshot(incoming)
	}

	merged := current
	merged.Prompts = mergePromptMeta(current.Prompts, incoming.Prompts)
	merged.Contexts = mergeContextMeta(current.Contexts, incoming.Contexts)
	merged.Tools = mergeToolMeta(current.Tools, incoming.Tools)
	merged.Definitions = mergeProjectDefinitions(current.Definitions, incoming.Definitions)
	merged.Relations = mergeProjectRelations(current.Relations, incoming.Relations)
	merged.Sources = mergeIndexSources(current.Sources, incoming.Sources)
	merged.Diagnostics = mergeIndexDiagnostics(current.Diagnostics, filterRuntimeIndexDiagnostics(incoming.Diagnostics))
	merged.LintFindings = mergeIndexLintFindings(current.LintFindings, incoming.LintFindings)
	if incoming.Lint != nil {
		merged.Lint = incoming.Lint
	}
	if incoming.SchemaVersion != 0 {
		merged.SchemaVersion = incoming.SchemaVersion
	}
	if incoming.Indexing != nil {
		merged.Indexing = incoming.Indexing
	}
	if incoming.SourceGraph != nil {
		merged.SourceGraph = incoming.SourceGraph
	}
	return normalizeRuntimeIndexSnapshot(merged)
}

func normalizeRuntimeIndexSnapshot(index store.IndexData) store.IndexData {
	index.Prompts = mergePromptMeta(nil, index.Prompts)
	index.Contexts = mergeContextMeta(nil, index.Contexts)
	index.Tools = mergeToolMeta(nil, index.Tools)
	index.Definitions = mergeProjectDefinitions(nil, index.Definitions)
	index.Relations = mergeProjectRelations(nil, index.Relations)
	index.Sources = mergeIndexSources(nil, index.Sources)
	index.Diagnostics = mergeIndexDiagnostics(nil, index.Diagnostics)
	index.LintFindings = mergeIndexLintFindings(nil, index.LintFindings)
	return index
}

func isEmptyIndex(index store.IndexData) bool {
	return len(index.Prompts) == 0 &&
		len(index.Contexts) == 0 &&
		len(index.Tools) == 0 &&
		len(index.Definitions) == 0 &&
		len(index.Relations) == 0 &&
		len(index.Diagnostics) == 0 &&
		len(index.LintFindings) == 0 &&
		len(index.Sources) == 0
}

func isStaticOnlyIndex(index store.IndexData) bool {
	for _, diagnostic := range index.Diagnostics {
		if diagnostic.Code == "index.static_only" {
			return true
		}
	}
	return false
}

func hasStaticOnlyDiagnostic(diagnostics []store.IndexDiagnostic) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == "index.static_only" {
			return true
		}
	}
	return false
}

func hasOnlyStaticOnlyDiagnostics(diagnostics []store.IndexDiagnostic) bool {
	if len(diagnostics) == 0 {
		return false
	}
	for _, diagnostic := range diagnostics {
		if diagnostic.Code != "index.static_only" {
			return false
		}
	}
	return true
}

func hasResolvedDefinitions(index store.IndexData) bool {
	for _, definition := range index.Definitions {
		if definition.Fidelity == "resolved" {
			return true
		}
	}
	return false
}

func filterRuntimeIndexDiagnostics(diagnostics []store.IndexDiagnostic) []store.IndexDiagnostic {
	filtered := make([]store.IndexDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == "index.static_only" {
			continue
		}
		filtered = append(filtered, diagnostic)
	}
	return filtered
}

func mergePromptMeta(current, incoming []store.PromptMeta) []store.PromptMeta {
	merged := make([]store.PromptMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeContextMeta(current, incoming []store.ContextMeta) []store.ContextMeta {
	merged := make([]store.ContextMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeToolMeta(current, incoming []store.ToolMeta) []store.ToolMeta {
	merged := make([]store.ToolMeta, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.Name] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.Name]; ok {
			merged[existing] = item
			continue
		}
		index[item.Name] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeProjectDefinitions(current, incoming []store.ProjectDefinition) []store.ProjectDefinition {
	merged := make([]store.ProjectDefinition, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = mergeProjectDefinition(merged[existing], item)
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = mergeProjectDefinition(merged[existing], item)
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeProjectDefinition(existing, incoming store.ProjectDefinition) store.ProjectDefinition {
	if fidelityRank(existing.Fidelity) > fidelityRank(incoming.Fidelity) {
		incoming.Fidelity = existing.Fidelity
	}
	if incoming.Status == "" {
		incoming.Status = existing.Status
	}
	if incoming.Source == nil {
		incoming.Source = existing.Source
	}
	if incoming.SourceSnippet == nil {
		incoming.SourceSnippet = existing.SourceSnippet
	}
	if len(incoming.SourceRefs) == 0 {
		incoming.SourceRefs = existing.SourceRefs
	}
	if incoming.Description == "" {
		incoming.Description = existing.Description
	}
	if len(incoming.Tags) == 0 {
		incoming.Tags = existing.Tags
	}
	if len(incoming.Path) == 0 {
		incoming.Path = existing.Path
	}
	if incoming.Fingerprint == "" {
		incoming.Fingerprint = existing.Fingerprint
	}
	if incoming.Metadata == nil {
		incoming.Metadata = existing.Metadata
	} else if existing.Metadata != nil {
		incoming.Metadata = mergeMetadataRaw(existing.Metadata, incoming.Metadata)
	}
	if incoming.Quality == nil {
		incoming.Quality = existing.Quality
	}
	return incoming
}

func fidelityRank(fidelity string) int {
	switch fidelity {
	case "resolved":
		return 3
	case "partial":
		return 2
	case "error":
		return 1
	default:
		return 0
	}
}

func mergeMetadataRaw(existing, incoming json.RawMessage) json.RawMessage {
	var existingMap map[string]any
	var incomingMap map[string]any
	if err := json.Unmarshal(existing, &existingMap); err != nil || existingMap == nil {
		return incoming
	}
	if err := json.Unmarshal(incoming, &incomingMap); err != nil || incomingMap == nil {
		return incoming
	}
	merged := map[string]any{}
	for key, value := range existingMap {
		merged[key] = value
	}
	for key, value := range incomingMap {
		merged[key] = value
	}
	merged = mergeDefinitionFactsMetadata(existingMap, incomingMap, merged)
	data, err := json.Marshal(merged)
	if err != nil {
		return incoming
	}
	return data
}

func mergeDefinitionFactsMetadata(existingMap, incomingMap, merged map[string]any) map[string]any {
	existingFacts, existingOK := existingMap["facts"].(map[string]any)
	incomingFacts, incomingOK := incomingMap["facts"].(map[string]any)
	if !existingOK && !incomingOK {
		return merged
	}
	facts := map[string]any{}
	for key, value := range existingFacts {
		facts[key] = value
	}
	for key, value := range incomingFacts {
		facts[key] = value
	}
	useEntries := appendJSONLists(existingFacts["useEntries"], incomingFacts["useEntries"])
	if len(useEntries) > 0 {
		facts["useEntries"] = useEntries
	}
	merged["facts"] = facts
	return merged
}

func appendJSONLists(existing, incoming any) []any {
	out := []any{}
	if list, ok := existing.([]any); ok {
		out = append(out, list...)
	}
	if list, ok := incoming.([]any); ok {
		out = append(out, list...)
	}
	return dedupeJSONList(out)
}

func dedupeJSONList(items []any) []any {
	seen := map[string]bool{}
	out := make([]any, 0, len(items))
	for _, item := range items {
		data, err := json.Marshal(item)
		key := string(data)
		if err != nil {
			key = fmt.Sprintf("%#v", item)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func mergeProjectRelations(current, incoming []store.ProjectRelation) []store.ProjectRelation {
	merged := make([]store.ProjectRelation, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		key := relationMergeKey(item)
		if existing, ok := index[key]; ok {
			merged[existing] = item
			continue
		}
		index[key] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		key := relationMergeKey(item)
		if existing, ok := index[key]; ok {
			merged[existing] = item
			continue
		}
		index[key] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeIndexSources(current, incoming []store.IndexSourceFile) []store.IndexSourceFile {
	merged := make([]store.IndexSourceFile, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.File]; ok {
			merged[existing] = item
			continue
		}
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeIndexDiagnostics(current, incoming []store.IndexDiagnostic) []store.IndexDiagnostic {
	merged := make([]store.IndexDiagnostic, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		if item.Code == "index.static_only" {
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if item.Code == "index.static_only" {
			continue
		}
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeIndexLintFindings(current, incoming []store.IndexLintFinding) []store.IndexLintFinding {
	merged := make([]store.IndexLintFinding, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.ID]; ok {
			merged[existing] = item
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func (s *Service) Context() api.DevtoolsContext {
	var ctx api.DevtoolsContext
	wd, _ := os.Getwd()
	ctx.Project.Path = wd
	ctx.Project.Name = filepath.Base(wd)
	ctx.Version = "dev"
	ctx.Git.Branch = strings.TrimSpace(runGit("branch", "--show-current"))
	sha := strings.TrimSpace(runGit("rev-parse", "--short=7", "HEAD"))
	ctx.Git.CommitSHA = sha
	ctx.Git.Dirty = strings.TrimSpace(runGit("status", "--porcelain")) != ""
	ctx.Target.Kind = "agent"
	return ctx
}

func runGit(args ...string) string {
	cmd := exec.Command("git", args...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return string(out)
}

func queryIntValue(query url.Values, key string, defaultVal int) int {
	value := query.Get(key)
	if value == "" {
		return defaultVal
	}
	var n int
	if _, err := fmt.Sscanf(value, "%d", &n); err != nil {
		return defaultVal
	}
	return n
}

func queryInt64Value(query url.Values, key string, defaultVal int64) int64 {
	value := query.Get(key)
	if value == "" {
		return defaultVal
	}
	var n int64
	if _, err := fmt.Sscanf(value, "%d", &n); err != nil {
		return defaultVal
	}
	return n
}
