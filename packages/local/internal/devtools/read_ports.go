package devtools

import (
	"context"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) RuntimeFlowRuns(context.Context) []store.RuntimeFlowRunData {
	return s.store.GetRuntimeFlowRuns()
}

func (s *Service) ObservedInjection(ctx context.Context, limit int) (any, error) {
	return observedInjectionReadModelFromObservability(ctx, s.observability, s.indexReadModel(), limit)
}

func (s *Service) Stats(ctx context.Context) store.StatsResult {
	if s.observability != nil {
		return observabilityStats(ctx, s.observability)
	}
	return s.store.GetStats()
}

func (s *Service) Timeseries(ctx context.Context, buckets int) []store.TimeseriesBucket {
	if s.observability != nil {
		return observabilityTimeseries(ctx, s.observability, buckets)
	}
	return s.store.GetTimeseries(buckets)
}

func (s *Service) PromptBaselines(ctx context.Context, window int) []store.PromptBaseline {
	if s.observability != nil {
		return observabilityPromptBaselines(ctx, s.observability, window)
	}
	return s.store.GetPromptBaselines(window)
}

func (s *Service) PromptUsage(ctx context.Context) map[string]store.PromptUsageStat {
	if s.observability != nil {
		return observabilityPromptUsage(ctx, s.observability)
	}
	return s.store.GetPromptUsageStats()
}

func (s *Service) DroppedContexts(ctx context.Context) map[string]store.DroppedContextFrequency {
	if s.observability != nil {
		return observabilityDroppedContexts(ctx, s.observability)
	}
	return s.store.GetDroppedContextFrequency()
}

func (s *Service) JudgeTimeseries(_ context.Context, buckets int) []store.JudgeTimeseriesBucket {
	return s.store.GetJudgeTimeseries(buckets)
}

func (s *Service) MemoryEvents(context.Context) []store.MemoryEventData {
	return s.store.GetMemoryEvents()
}

func (s *Service) MemoryInstances(context.Context) []store.MemoryInstanceData {
	return s.store.GetMemoryInstances()
}

func (s *Service) MemoryInstance(_ context.Context, memoryID string) (*store.MemoryInstanceData, bool) {
	instance := s.store.GetMemoryInstance(memoryID)
	return instance, instance != nil
}

func (s *Service) MemoryStores(ctx context.Context) (any, error) {
	return s.memoryStores(ctx)
}

func (s *Service) MemoryOperations(ctx context.Context, since, until int64, limit int) (any, error) {
	return s.memoryOperations(ctx, since, until, limit)
}

func (s *Service) MemoryStoreDetail(ctx context.Context, storeID string) (any, bool, error) {
	return s.memoryStoreDetail(ctx, decodePathSegment(storeID))
}

func (s *Service) EmbeddingEvents(context.Context) []store.EmbeddingEventData {
	return s.store.GetEmbeddingEvents()
}

func (s *Service) RetrievalEvents(context.Context) []store.RetrievalEventData {
	return s.store.GetRetrievalEvents()
}

func (s *Service) RetrievalStageEvents(context.Context) []store.RetrievalStageEventData {
	return s.store.GetRetrievalStageEvents()
}

func (s *Service) IndexEventRecords(context.Context) []store.IndexEventData {
	return s.store.GetIndexEvents()
}

func (s *Service) CorpusEvents(context.Context) []store.CorpusEventData {
	return s.store.GetCorpusEvents()
}

func (s *Service) IngestEvents(context.Context) []store.IngestEventData {
	return s.store.GetIngestEvents()
}

func (s *Service) CompactEvents(context.Context) []store.CompactEventData {
	return s.store.GetCompactEvents()
}

func (s *Service) BudgetSnapshots(context.Context) []store.BudgetSnapshotData {
	return s.store.GetBudgetSnapshots()
}

func (s *Service) CostEvents(context.Context) []store.CostEventData {
	return s.store.GetCostEvents()
}

func (s *Service) AgentEvents(context.Context) []store.AgentEventData {
	return s.store.GetAgentEvents()
}

func (s *Service) JudgeEvents(context.Context) []store.JudgeEventData {
	return s.store.GetJudgeEvents()
}

func (s *Service) DelegateEvents(context.Context) []store.DelegateEventData {
	return s.store.GetDelegateEvents()
}

func (s *Service) ToolEvents(context.Context) []store.ToolEventData {
	return s.store.GetToolEvents()
}

func (s *Service) SecurityEvents(context.Context) []store.SecurityEventData {
	return s.store.GetSecurityEvents()
}

func (s *Service) CompositionStats(context.Context) store.CompositionStatsResult {
	return s.store.GetCompositionStats()
}

func (s *Service) SecurityByPrompt(context.Context) map[string]store.SecurityByPrompt {
	return s.store.GetSecurityByPrompt()
}

func (s *Service) TaskListEvents(context.Context) []store.TaskListEventData {
	return s.store.GetTaskListEvents()
}

func (s *Service) TaskEvents(context.Context) []store.TaskEventData {
	return s.store.GetTaskEvents()
}

func (s *Service) GuardrailRuns(context.Context) []store.GuardrailRunEvent {
	return s.store.GetGuardrailRuns()
}

func (s *Service) ConstraintEvents(context.Context) map[string]any {
	return map[string]any{
		"checks":     s.store.GetConstraintChecks(),
		"retries":    s.store.GetConstraintRetries(),
		"violations": s.store.GetConstraintViolations(),
	}
}

func (s *Service) Timeline(ctx context.Context, session string) []store.TimelineEvent {
	if s.observability != nil {
		return observabilityTimeline(ctx, s.observability, session)
	}
	return s.store.GetAllEvents(session)
}

func (s *Service) Sessions(ctx context.Context) []store.SessionInfo {
	if s.observability != nil {
		return observabilitySessions(ctx, s.observability)
	}
	return s.store.GetSessions()
}

func (s *Service) Plans(ctx context.Context) (any, error) {
	return s.plans(ctx)
}

func (s *Service) PlanDetail(ctx context.Context, path string) (any, bool, error) {
	planID, suffix, hasSuffix := strings.Cut(path, "/")
	planID = decodePathSegment(planID)
	if hasSuffix && suffix == "diff" {
		return nil, false, nil
	}
	detail, found := s.planDetail(ctx, planID)
	return detail, found, nil
}

func (s *Service) Workspaces(ctx context.Context) (any, error) {
	return s.workspaceSummaries(ctx)
}

func (s *Service) WorkspaceDetail(ctx context.Context, path string) (any, bool, error) {
	parts := strings.Split(path, "/")
	workspaceID := decodePathSegment(parts[0])
	if len(parts) >= 3 && parts[1] == "files" {
		filePath := decodePathSegment(strings.Join(parts[2:], "/"))
		if strings.HasSuffix(filePath, "/diff") {
			return nil, false, nil
		}
		return s.workspaceFileDetail(ctx, workspaceID, filePath)
	}
	return s.workspaceDetail(ctx, workspaceID)
}

func (s *Service) DevtoolsContext(context.Context) api.DevtoolsContext {
	return s.Context()
}
