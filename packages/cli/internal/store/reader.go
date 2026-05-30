package store

// StoreReader provides read-only access to the store.
// The TUI uses this interface to read data directly instead of via HTTP.
type StoreReader interface {
	GetCatalog() CatalogData
	GetEvalRuns() []EvalRun
	GetEvalRun(evalID string) *EvalRun
	GetEvalBaseline(promptID string) *EvalRun
	GetRagEvalRuns() []RagEvalRun
	GetRagEvalRun(evalID string) *RagEvalRun
	GetFlowRuns() []FlowRun
	GetFlowRun(flowID string) *FlowRun
	GetRuntimeFlowRuns() []RuntimeFlowRunData
	GetRuntimeFlowRun(flowID, sessionID string) *RuntimeFlowRunData
	GetStats() StatsResult
	GetSessions() []SessionInfo
	GetPromptUsageStats() map[string]PromptUsageStat
	GetTimeseries(buckets int) []TimeseriesBucket
	GetPromptBaselines(window int) []PromptBaseline
	GetCompositionStats() CompositionStatsResult
	GetDroppedContextFrequency() map[string]DroppedContextFrequency
	GetAllEvents(sessionFilter string) []TimelineEvent
	GetJudgeTimeseries(buckets int) []JudgeTimeseriesBucket
	GetMemoryEvents() []MemoryEventData
	GetMemoryInstances() []MemoryInstanceData
	GetMemoryInstance(memoryID string) *MemoryInstanceData
	GetCompactEvents() []CompactEventData
	GetBudgetSnapshots() []BudgetSnapshotData
	GetAgentEvents() []AgentEventData
	GetJudgeEvents() []JudgeEventData
	GetDelegateEvents() []DelegateEventData
	GetEmbeddingEvents() []EmbeddingEventData
	GetRetrievalEvents() []RetrievalEventData
	GetRetrievalStageEvents() []RetrievalStageEventData
	GetWorkspaceEvents() []WorkspaceEventData
	GetIndexEvents() []IndexEventData
	GetCorpusEvents() []CorpusEventData
	GetToolEvents() []ToolEventData
	GetSecurityEvents() []SecurityEventData
	GetSecurityByPrompt() map[string]SecurityByPrompt
	GetCompositionEvents() []CompositionEventData
	GetPlanEvents() []PlanEventData
	GetTaskListEvents() []TaskListEventData
	GetTaskEvents() []TaskEventData
	GetGuardrailRuns() []GuardrailRunEvent
	GetConstraintChecks() []ConstraintCheckEvent
	GetConstraintRetries() []ConstraintRetryEvent
	GetConstraintViolations() []ConstraintViolationEvent
	GetContextCacheHits() int
	GetContextCacheMisses() int
	GetSemanticCacheHits() int
	GetSemanticCacheMisses() int
	GetSemanticCacheWrites() int
	GetSkillLoads() int
	GetSkillCacheHits() int
	GetSkillCacheMisses() int
	GetSkillResolves() int
	Subscribe() <-chan struct{}
}

// Verify Store implements StoreReader at compile time.
var _ StoreReader = (*Store)(nil)
