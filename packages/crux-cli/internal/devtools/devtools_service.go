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

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/observability"
	"github.com/anthropics/crux-cli/internal/quality"
	"github.com/anthropics/crux-cli/internal/resourceinspection"
	"github.com/anthropics/crux-cli/internal/store"
)

// ProjectCatalogIndexer owns source discovery for the Project Catalog.
type ProjectCatalogIndexer interface {
	IndexProject(ctx context.Context, root, configPath, projectName string) (store.CatalogData, error)
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
	catalogEvents *CatalogEventBus
	indexer       ProjectCatalogIndexer
}

const defaultProjectCatalogReindexTimeout = 120 * time.Second

func NewService(s *store.Store, qualitySvc *quality.Service) *Service {
	if qualitySvc == nil {
		qualitySvc = quality.NewService(s, quality.Dir(""))
	}
	ctx, cancel := context.WithCancel(context.Background())
	service := &Service{
		ctx:           ctx,
		cancel:        cancel,
		store:         s,
		quality:       qualitySvc,
		catalogEvents: NewCatalogEventBus(),
	}
	service.startCatalogChangePublisher()
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

func (s *Service) WithProjectCatalogIndexer(indexer ProjectCatalogIndexer) *Service {
	s.indexer = indexer
	return s
}

func (s *Service) startCatalogChangePublisher() {
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
				s.catalogEvents.Publish(s.catalogReadModel())
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

func (s *Service) CatalogEvents() *CatalogEventBus {
	return s.catalogEvents
}

func (s *Service) SubscribeChanges() <-chan struct{} {
	return s.store.Subscribe()
}

func (s *Service) RegisterCatalogSnapshot(_ context.Context, catalog store.CatalogData) {
	s.store.SetCatalogData(mergeRuntimeCatalogSnapshot(s.store.GetCatalog(), catalog))
	s.catalogEvents.Publish(s.catalogReadModel())
}

func (s *Service) ReindexProject(ctx context.Context, root, configPath, projectName string) (store.CatalogData, error) {
	if s.indexer == nil {
		return store.CatalogData{}, fmt.Errorf("project catalog indexer is not configured")
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultProjectCatalogReindexTimeout)
		defer cancel()
	}
	startedAt := time.Now()
	catalog, err := s.indexer.IndexProject(ctx, root, configPath, projectName)
	if err != nil {
		return store.CatalogData{}, err
	}
	if catalog.IndexedAt == "" {
		catalog.IndexedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	catalog.Indexing = store.ReadyCatalogIndexingStatus(catalog.IndexedAt, time.Since(startedAt), len(catalog.Sources), len(catalog.Diagnostics), isStaticOnlyCatalog(catalog))
	if isStaticOnlyCatalog(catalog) && hasResolvedDefinitions(s.store.GetCatalog()) {
		return s.catalogReadModel(), nil
	}
	s.store.SetCatalogData(catalog)
	s.catalogEvents.Publish(s.catalogReadModel())
	return s.catalogReadModel(), nil
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
	case "/api/catalog":
		return s.catalogReadModel(), true, nil
	case "/api/project/catalog":
		return s.catalogReadModel(), true, nil
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
	case "/api/index":
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

func (s *Service) catalogReadModel() store.CatalogData {
	catalog := s.store.GetCatalog()
	if s.quality == nil {
		return catalog
	}
	return s.quality.EnrichCatalog(catalog)
}

func mergeRuntimeCatalogSnapshot(current, incoming store.CatalogData) store.CatalogData {
	if isEmptyCatalog(current) {
		incoming.Diagnostics = filterRuntimeCatalogDiagnostics(incoming.Diagnostics)
		return incoming
	}

	merged := current
	merged.Prompts = mergePromptMeta(current.Prompts, incoming.Prompts)
	merged.Contexts = mergeContextMeta(current.Contexts, incoming.Contexts)
	merged.Tools = mergeToolMeta(current.Tools, incoming.Tools)
	merged.Definitions = mergeProjectDefinitions(current.Definitions, incoming.Definitions)
	merged.Relations = mergeProjectRelations(current.Relations, incoming.Relations)
	merged.Sources = mergeCatalogSources(current.Sources, incoming.Sources)
	merged.Diagnostics = mergeCatalogDiagnostics(current.Diagnostics, filterRuntimeCatalogDiagnostics(incoming.Diagnostics))
	merged.LintFindings = mergeCatalogLintFindings(current.LintFindings, incoming.LintFindings)
	if incoming.Lint != nil {
		merged.Lint = incoming.Lint
	}
	if incoming.SchemaVersion != 0 {
		merged.SchemaVersion = incoming.SchemaVersion
	}
	if incoming.Indexing != nil {
		merged.Indexing = incoming.Indexing
	}
	return merged
}

func isEmptyCatalog(catalog store.CatalogData) bool {
	return len(catalog.Prompts) == 0 &&
		len(catalog.Contexts) == 0 &&
		len(catalog.Tools) == 0 &&
		len(catalog.Definitions) == 0 &&
		len(catalog.Relations) == 0 &&
		len(catalog.Diagnostics) == 0 &&
		len(catalog.LintFindings) == 0 &&
		len(catalog.Sources) == 0
}

func isStaticOnlyCatalog(catalog store.CatalogData) bool {
	for _, diagnostic := range catalog.Diagnostics {
		if diagnostic.Code == "catalog.static_only" {
			return true
		}
	}
	return false
}

func hasResolvedDefinitions(catalog store.CatalogData) bool {
	for _, definition := range catalog.Definitions {
		if definition.Fidelity == "resolved" {
			return true
		}
	}
	return false
}

func filterRuntimeCatalogDiagnostics(diagnostics []store.CatalogDiagnostic) []store.CatalogDiagnostic {
	filtered := make([]store.CatalogDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == "catalog.static_only" {
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
	data, err := json.Marshal(merged)
	if err != nil {
		return incoming
	}
	return data
}

func mergeProjectRelations(current, incoming []store.ProjectRelation) []store.ProjectRelation {
	merged := make([]store.ProjectRelation, 0, len(current)+len(incoming))
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

func mergeCatalogSources(current, incoming []store.CatalogSourceFile) []store.CatalogSourceFile {
	merged := make([]store.CatalogSourceFile, 0, len(current)+len(incoming))
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

func mergeCatalogDiagnostics(current, incoming []store.CatalogDiagnostic) []store.CatalogDiagnostic {
	merged := make([]store.CatalogDiagnostic, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		if item.Code == "catalog.static_only" {
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if item.Code == "catalog.static_only" {
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

func mergeCatalogLintFindings(current, incoming []store.CatalogLintFinding) []store.CatalogLintFinding {
	merged := make([]store.CatalogLintFinding, 0, len(current)+len(incoming))
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
