package endpoints

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/review"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type DevtoolsReads interface {
	ProjectIndex(context.Context) (api.IndexData, error)
	ProjectIndexWatchStatus(context.Context) (api.ProjectIndexWatchStatus, error)
}

// CatalogReads exposes the stable Catalog projections independently from the
// legacy raw Project Index endpoint.
type CatalogReads interface {
	CatalogList(context.Context, string) (api.CatalogListV1, error)
	CatalogDefinition(context.Context, string) (api.CatalogDefinitionV1, bool, error)
	CatalogExplanation(context.Context, string) (api.CatalogExplanationV1, bool, error)
	CatalogStatus(context.Context) (api.CatalogStatusV1, error)
}

type InspectReads interface {
	ActivityAPI(context.Context, int) ([]api.InspectActivityEvent, error)
	RunsWithOptionsAPI(context.Context, api.InspectRunsOptions) ([]api.InspectRunRecord, error)
	RunDetailAPI(context.Context, string) (api.InspectRunDetailRecord, bool, error)
	InsightsAPI(context.Context) ([]api.InspectInsightRecord, error)
	InsightSilencesAPI(context.Context, bool) ([]api.InspectInsightSilenceRecord, error)
	OverviewRecordAPI(context.Context, ...string) (api.InspectOverviewRecord, error)
}

type EvalCatalogReads interface {
	EvalManifests(context.Context) ([]json.RawMessage, error)
}

type ReviewReads interface {
	ListReviews(context.Context) ([]review.Projection, error)
	ReviewDetail(context.Context, string) (review.Detail, bool, error)
}

type Deps struct {
	Devtools    DevtoolsReads
	Catalog     CatalogReads
	Inspect     InspectReads
	Eval        EvalReads
	EvalCatalog EvalCatalogReads
	Reviews     ReviewReads
}

var Registry = readmodel.NewRegistry[Deps]()

var ProjectIndex = readmodel.Get(Registry, "GET /api/project/index",
	func(ctx context.Context, deps Deps) (api.IndexData, error) {
		return deps.Devtools.ProjectIndex(ctx)
	},
	readmodel.Alias[Deps, api.IndexData]("GET /api/index"),
	readmodel.SnapshotAlways[Deps, api.IndexData]("index", ""))

var ProjectIndexWatch = readmodel.Get(Registry, "GET /api/project/index/watch",
	func(ctx context.Context, deps Deps) (api.ProjectIndexWatchStatus, error) {
		return deps.Devtools.ProjectIndexWatchStatus(ctx)
	})

var InspectActivity = readmodel.GetP[Deps, *readmodel.Limit, []api.InspectActivityEvent](Registry, "GET /api/inspect/activity",
	func() *readmodel.Limit { return &readmodel.Limit{} },
	func(ctx context.Context, deps Deps, params *readmodel.Limit) ([]api.InspectActivityEvent, error) {
		return deps.Inspect.ActivityAPI(ctx, params.N)
	})

var InspectOverview = readmodel.GetP[Deps, *InspectOverviewParams, api.InspectOverviewRecord](Registry, "GET /api/inspect/overview",
	func() *InspectOverviewParams { return &InspectOverviewParams{} },
	func(ctx context.Context, deps Deps, params *InspectOverviewParams) (api.InspectOverviewRecord, error) {
		return deps.Inspect.OverviewRecordAPI(ctx, params.Window)
	})

var InspectInsights = readmodel.Get(Registry, "GET /api/inspect/insights",
	func(ctx context.Context, deps Deps) ([]api.InspectInsightRecord, error) {
		return deps.Inspect.InsightsAPI(ctx)
	})

var InspectInsightSilences = readmodel.GetP[Deps, *IncludeDeletedParams, []api.InspectInsightSilenceRecord](Registry, "GET /api/inspect/insights/silences",
	func() *IncludeDeletedParams { return &IncludeDeletedParams{} },
	func(ctx context.Context, deps Deps, params *IncludeDeletedParams) ([]api.InspectInsightSilenceRecord, error) {
		return deps.Inspect.InsightSilencesAPI(ctx, params.IncludeDeleted)
	})

var InspectRuns = readmodel.GetP[Deps, *RunsParams, []api.InspectRunRecord](Registry, "GET /api/inspect/runs",
	func() *RunsParams { return &RunsParams{} },
	func(ctx context.Context, deps Deps, params *RunsParams) ([]api.InspectRunRecord, error) {
		return deps.Inspect.RunsWithOptionsAPI(ctx, params.InspectRunsOptions)
	})

var InspectRunDetail = readmodel.GetP[Deps, *readmodel.PathID, api.InspectRunDetailRecord](Registry, "GET /api/inspect/runs/{traceId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "traceId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (api.InspectRunDetailRecord, error) {
		record, found, err := deps.Inspect.RunDetailAPI(ctx, params.ID)
		if err != nil || found {
			return record, err
		}
		return record, readmodel.ErrNotFound
	})

type observedInjectionReads interface {
	ObservedInjection(context.Context, int) (any, error)
}

type runtimeEventReads interface {
	RuntimeFlowRuns(context.Context) []store.RuntimeFlowRunData
	Stats(context.Context) store.StatsResult
	Timeseries(context.Context, int) []store.TimeseriesBucket
	PromptBaselines(context.Context, int) []store.PromptBaseline
	PromptUsage(context.Context) map[string]store.PromptUsageStat
	DroppedContexts(context.Context) map[string]store.DroppedContextFrequency
	JudgeTimeseries(context.Context, int) []store.JudgeTimeseriesBucket
	MemoryEvents(context.Context) []store.MemoryEventData
	MemoryInstances(context.Context) []store.MemoryInstanceData
	MemoryInstance(context.Context, string) (*store.MemoryInstanceData, bool)
	MemoryStores(context.Context) (any, error)
	MemoryOperations(context.Context, int64, int64, int) (any, error)
	MemoryStoreDetail(context.Context, string) (any, bool, error)
	EmbeddingEvents(context.Context) []store.EmbeddingEventData
	RetrievalEvents(context.Context) []store.RetrievalEventData
	RetrievalStageEvents(context.Context) []store.RetrievalStageEventData
	IndexEventRecords(context.Context) []store.IndexEventData
	CorpusEvents(context.Context) []store.CorpusEventData
	IngestEvents(context.Context) []store.IngestEventData
	CompactEvents(context.Context) []store.CompactEventData
	BudgetSnapshots(context.Context) []store.BudgetSnapshotData
	CostEvents(context.Context) []store.CostEventData
	AgentEvents(context.Context) []store.AgentEventData
	JudgeEvents(context.Context) []store.JudgeEventData
	DelegateEvents(context.Context) []store.DelegateEventData
	ToolEvents(context.Context) []store.ToolEventData
	SecurityEvents(context.Context) []store.SecurityEventData
	CompositionStats(context.Context) store.CompositionStatsResult
	SecurityByPrompt(context.Context) map[string]store.SecurityByPrompt
	TaskListEvents(context.Context) []store.TaskListEventData
	TaskEvents(context.Context) []store.TaskEventData
	GuardrailRuns(context.Context) []store.GuardrailRunEvent
	ConstraintEvents(context.Context) map[string]any
	Timeline(context.Context, string) []store.TimelineEvent
	Sessions(context.Context) []store.SessionInfo
	Plans(context.Context) (any, error)
	PlanDetail(context.Context, string) (any, bool, error)
	Workspaces(context.Context) (any, error)
	WorkspaceDetail(context.Context, string) (any, bool, error)
	DevtoolsContext(context.Context) api.DevtoolsContext
}

func getSnapshot[T any](pattern, message, field string, call func(context.Context, Deps) (T, error)) *readmodel.Handle[Deps, T] {
	return readmodel.Get(Registry, pattern, call, readmodel.SnapshotIn[Deps, T](message, field))
}

type intQueryParam struct {
	Name    string
	Default int
	Value   int
}

func (p *intQueryParam) Parse(req readmodel.Req) error {
	limit := &readmodel.Limit{Default: p.Default}
	if p.Name == "limit" {
		if err := limit.Parse(req); err != nil {
			return err
		}
		p.Value = limit.N
		return nil
	}
	raw := req.Query.Get(p.Name)
	if raw == "" {
		p.Value = p.Default
		return nil
	}
	limitReq := readmodel.Req{Query: url.Values{"limit": []string{raw}}}
	if err := limit.Parse(limitReq); err != nil {
		return readmodel.BadRequest("invalid " + p.Name)
	}
	p.Value = limit.N
	return nil
}

type sessionParam struct {
	Session string
}

func (p *sessionParam) Parse(req readmodel.Req) error {
	p.Session = req.Query.Get("session")
	return nil
}

type memoryOperationsParams struct {
	Since int64
	Until int64
	Limit int
}

func (p *memoryOperationsParams) Parse(req readmodel.Req) error {
	var err error
	if p.Since, err = parseInt64(req.Query.Get("since"), 0); err != nil {
		return readmodel.BadRequest("invalid since")
	}
	if p.Until, err = parseInt64(req.Query.Get("until"), 0); err != nil {
		return readmodel.BadRequest("invalid until")
	}
	limit := &readmodel.Limit{Default: 50}
	if err := limit.Parse(req); err != nil {
		return err
	}
	p.Limit = limit.N
	return nil
}

func parseInt64(raw string, fallback int64) (int64, error) {
	if raw == "" {
		return fallback, nil
	}
	var n int64
	if _, err := fmt.Sscanf(raw, "%d", &n); err != nil {
		return 0, err
	}
	return n, nil
}

func observabilityInvalidation(matches func(observability.Event) bool, message func(observability.Event) map[string]any) readmodel.InvalidationSelector {
	return func(event any) (map[string]any, bool) {
		observabilityEvent, ok := event.(observability.Event)
		if !ok || !matches(observabilityEvent) {
			return nil, false
		}
		return message(observabilityEvent), true
	}
}

func libraryEventPayload(event observability.Event) map[string]any {
	return map[string]any{
		"id":        event.ID,
		"timestamp": event.Timestamp,
		"refId":     event.RefID,
		"action":    event.Action,
	}
}

func memoryInvalidation() readmodel.InvalidationSelector {
	return observabilityInvalidation(func(event observability.Event) bool {
		return event.Kind == "memory" || event.Kind == "memory.read" || event.Kind == "memory.write"
	}, func(event observability.Event) map[string]any {
		return map[string]any{
			"type":  "memory:event",
			"_tag":  "MemoryStoreEvent",
			"kind":  "state",
			"event": libraryEventPayload(event),
		}
	})
}

func workspaceInvalidation() readmodel.InvalidationSelector {
	return observabilityInvalidation(func(event observability.Event) bool {
		return event.Kind == "workspace" || event.Kind == "workspace.operation"
	}, func(event observability.Event) map[string]any {
		return map[string]any{
			"type":  "workspace:event",
			"_tag":  "WorkspaceEvent",
			"kind":  "op",
			"event": libraryEventPayload(event),
		}
	})
}

func planInvalidation(kind string, matches func(observability.Event) bool) readmodel.InvalidationSelector {
	return observabilityInvalidation(matches, func(event observability.Event) map[string]any {
		return map[string]any{
			"type":  "plan:event",
			"_tag":  "PlanEvent",
			"kind":  kind,
			"event": libraryEventPayload(event),
		}
	})
}

var (
	LegacyObservedInjection = readmodel.GetP[Deps, *readmodel.Limit, any](Registry, "GET /api/project/index/observed-injection",
		func() *readmodel.Limit { return &readmodel.Limit{Default: 250} },
		func(ctx context.Context, deps Deps, params *readmodel.Limit) (any, error) {
			return deps.Devtools.(observedInjectionReads).ObservedInjection(ctx, params.N)
		})
	LegacyRuntimeFlows = readmodel.Get(Registry, "GET /api/runtime-flows",
		func(ctx context.Context, deps Deps) ([]store.RuntimeFlowRunData, error) {
			return deps.Devtools.(runtimeEventReads).RuntimeFlowRuns(ctx), nil
		})
	LegacyStats = readmodel.Get(Registry, "GET /api/stats",
		func(ctx context.Context, deps Deps) (store.StatsResult, error) {
			return deps.Devtools.(runtimeEventReads).Stats(ctx), nil
		})
	LegacyStatsTimeseries = readmodel.GetP[Deps, *intQueryParam, []store.TimeseriesBucket](Registry, "GET /api/stats/timeseries",
		func() *intQueryParam { return &intQueryParam{Name: "buckets", Default: 20} },
		func(ctx context.Context, deps Deps, params *intQueryParam) ([]store.TimeseriesBucket, error) {
			return deps.Devtools.(runtimeEventReads).Timeseries(ctx, params.Value), nil
		})
	LegacyStatsBaselines = readmodel.GetP[Deps, *intQueryParam, []store.PromptBaseline](Registry, "GET /api/stats/baselines",
		func() *intQueryParam { return &intQueryParam{Name: "window"} },
		func(ctx context.Context, deps Deps, params *intQueryParam) ([]store.PromptBaseline, error) {
			return deps.Devtools.(runtimeEventReads).PromptBaselines(ctx, params.Value), nil
		})
	LegacyStatsPromptUsage = readmodel.Get(Registry, "GET /api/stats/prompt-usage",
		func(ctx context.Context, deps Deps) (map[string]store.PromptUsageStat, error) {
			return deps.Devtools.(runtimeEventReads).PromptUsage(ctx), nil
		})
	LegacyStatsDroppedContexts = readmodel.Get(Registry, "GET /api/stats/dropped-contexts",
		func(ctx context.Context, deps Deps) (map[string]store.DroppedContextFrequency, error) {
			return deps.Devtools.(runtimeEventReads).DroppedContexts(ctx), nil
		})
	LegacyStatsJudgeTimeseries = readmodel.GetP[Deps, *intQueryParam, []store.JudgeTimeseriesBucket](Registry, "GET /api/stats/judge-timeseries",
		func() *intQueryParam { return &intQueryParam{Name: "buckets", Default: 20} },
		func(ctx context.Context, deps Deps, params *intQueryParam) ([]store.JudgeTimeseriesBucket, error) {
			return deps.Devtools.(runtimeEventReads).JudgeTimeseries(ctx, params.Value), nil
		})
	LegacyMemoryEvents = readmodel.Get(Registry, "GET /api/memory",
		func(ctx context.Context, deps Deps) ([]store.MemoryEventData, error) {
			return deps.Devtools.(runtimeEventReads).MemoryEvents(ctx), nil
		},
		readmodel.InvalidatedBy[Deps, []store.MemoryEventData](memoryInvalidation()))
	LegacyMemoryInstances = readmodel.Get(Registry, "GET /api/memory/instances",
		func(ctx context.Context, deps Deps) ([]store.MemoryInstanceData, error) {
			return deps.Devtools.(runtimeEventReads).MemoryInstances(ctx), nil
		})
	LegacyMemoryInstance = readmodel.GetP[Deps, *readmodel.PathID, *store.MemoryInstanceData](Registry, "GET /api/memory/instances/{memoryId}",
		func() *readmodel.PathID { return &readmodel.PathID{Name: "memoryId"} },
		func(ctx context.Context, deps Deps, params *readmodel.PathID) (*store.MemoryInstanceData, error) {
			instance, found := deps.Devtools.(runtimeEventReads).MemoryInstance(ctx, params.ID)
			if !found {
				return nil, readmodel.ErrNotFound
			}
			return instance, nil
		})
	LegacyMemoryStores = readmodel.Get(Registry, "GET /api/memory/stores",
		func(ctx context.Context, deps Deps) (any, error) {
			return deps.Devtools.(runtimeEventReads).MemoryStores(ctx)
		})
	LegacyMemoryOperations = readmodel.GetP[Deps, *memoryOperationsParams, any](Registry, "GET /api/memory/operations",
		func() *memoryOperationsParams { return &memoryOperationsParams{} },
		func(ctx context.Context, deps Deps, params *memoryOperationsParams) (any, error) {
			return deps.Devtools.(runtimeEventReads).MemoryOperations(ctx, params.Since, params.Until, params.Limit)
		})
	LegacyMemoryStoreDetail = readmodel.GetP[Deps, *readmodel.PathID, any](Registry, "GET /api/memory/stores/{storeID...}",
		func() *readmodel.PathID { return &readmodel.PathID{Name: "storeID"} },
		func(ctx context.Context, deps Deps, params *readmodel.PathID) (any, error) {
			detail, found, err := deps.Devtools.(runtimeEventReads).MemoryStoreDetail(ctx, params.ID)
			if err != nil || found {
				return detail, err
			}
			return detail, readmodel.ErrNotFound
		})
	LegacyCompositionStats = readmodel.Get(Registry, "GET /api/compositions/stats",
		func(ctx context.Context, deps Deps) (store.CompositionStatsResult, error) {
			return deps.Devtools.(runtimeEventReads).CompositionStats(ctx), nil
		})
	LegacySecurityByPrompt = readmodel.Get(Registry, "GET /api/security/by-prompt",
		func(ctx context.Context, deps Deps) (map[string]store.SecurityByPrompt, error) {
			return deps.Devtools.(runtimeEventReads).SecurityByPrompt(ctx), nil
		})
	LegacyTaskLists = readmodel.Get(Registry, "GET /api/tasklists",
		func(ctx context.Context, deps Deps) ([]store.TaskListEventData, error) {
			return deps.Devtools.(runtimeEventReads).TaskListEvents(ctx), nil
		})
	LegacyTasks = readmodel.Get(Registry, "GET /api/tasks",
		func(ctx context.Context, deps Deps) ([]store.TaskEventData, error) {
			return deps.Devtools.(runtimeEventReads).TaskEvents(ctx), nil
		},
		readmodel.InvalidatedBy[Deps, []store.TaskEventData](planInvalidation("task", func(event observability.Event) bool {
			return event.Kind == "task" || event.Kind == "task.operation"
		})))
	LegacyGuardrails = readmodel.Get(Registry, "GET /api/guardrails",
		func(ctx context.Context, deps Deps) ([]store.GuardrailRunEvent, error) {
			return deps.Devtools.(runtimeEventReads).GuardrailRuns(ctx), nil
		})
	LegacyConstraints = readmodel.Get(Registry, "GET /api/constraints",
		func(ctx context.Context, deps Deps) (map[string]any, error) {
			return deps.Devtools.(runtimeEventReads).ConstraintEvents(ctx), nil
		})
	LegacyTimeline = readmodel.GetP[Deps, *sessionParam, []store.TimelineEvent](Registry, "GET /api/timeline",
		func() *sessionParam { return &sessionParam{} },
		func(ctx context.Context, deps Deps, params *sessionParam) ([]store.TimelineEvent, error) {
			return deps.Devtools.(runtimeEventReads).Timeline(ctx, params.Session), nil
		})
	LegacySessions = readmodel.Get(Registry, "GET /api/sessions",
		func(ctx context.Context, deps Deps) ([]store.SessionInfo, error) {
			return deps.Devtools.(runtimeEventReads).Sessions(ctx), nil
		})
	LegacyPlans = readmodel.Get(Registry, "GET /api/plans",
		func(ctx context.Context, deps Deps) (any, error) {
			return deps.Devtools.(runtimeEventReads).Plans(ctx)
		},
		readmodel.InvalidatedBy[Deps, any](planInvalidation("plan", func(event observability.Event) bool {
			return event.Kind == "plan" || event.Kind == "plan.operation"
		})))
	LegacyPlanDetail = readmodel.GetP[Deps, *readmodel.PathID, any](Registry, "GET /api/plans/{planPath...}",
		func() *readmodel.PathID { return &readmodel.PathID{Name: "planPath"} },
		func(ctx context.Context, deps Deps, params *readmodel.PathID) (any, error) {
			detail, found, err := deps.Devtools.(runtimeEventReads).PlanDetail(ctx, params.ID)
			if err != nil || found {
				return detail, err
			}
			return detail, readmodel.ErrNotFound
		})
	LegacyWorkspaces = readmodel.Get(Registry, "GET /api/workspaces",
		func(ctx context.Context, deps Deps) (any, error) {
			return deps.Devtools.(runtimeEventReads).Workspaces(ctx)
		},
		readmodel.InvalidatedBy[Deps, any](workspaceInvalidation()))
	LegacyWorkspaceDetail = readmodel.GetP[Deps, *readmodel.PathID, any](Registry, "GET /api/workspaces/{workspacePath...}",
		func() *readmodel.PathID { return &readmodel.PathID{Name: "workspacePath"} },
		func(ctx context.Context, deps Deps, params *readmodel.PathID) (any, error) {
			detail, found, err := deps.Devtools.(runtimeEventReads).WorkspaceDetail(ctx, params.ID)
			if err != nil || found {
				return detail, err
			}
			return detail, readmodel.ErrNotFound
		})
	LegacyDevtoolsContext = readmodel.Get(Registry, "GET /api/devtools/context",
		func(ctx context.Context, deps Deps) (api.DevtoolsContext, error) {
			return deps.Devtools.(runtimeEventReads).DevtoolsContext(ctx), nil
		})
	LegacyEmbeddingEvents = getSnapshot("GET /api/embedding", "runtime:snapshot", "embeddingEvents",
		func(ctx context.Context, deps Deps) ([]store.EmbeddingEventData, error) {
			return deps.Devtools.(runtimeEventReads).EmbeddingEvents(ctx), nil
		})
	LegacyRetrievalEvents = getSnapshot("GET /api/retrieval", "runtime:snapshot", "retrievalEvents",
		func(ctx context.Context, deps Deps) ([]store.RetrievalEventData, error) {
			return deps.Devtools.(runtimeEventReads).RetrievalEvents(ctx), nil
		})
	LegacyRetrievalStages = getSnapshot("GET /api/retrieval-stages", "runtime:snapshot", "retrievalStageEvents",
		func(ctx context.Context, deps Deps) ([]store.RetrievalStageEventData, error) {
			return deps.Devtools.(runtimeEventReads).RetrievalStageEvents(ctx), nil
		})
	LegacyIndexEvents = getSnapshot("GET /api/index/events", "runtime:snapshot", "indexEvents",
		func(ctx context.Context, deps Deps) ([]store.IndexEventData, error) {
			return deps.Devtools.(runtimeEventReads).IndexEventRecords(ctx), nil
		})
	LegacyCorpusEvents = getSnapshot("GET /api/corpus", "runtime:snapshot", "corpusEvents",
		func(ctx context.Context, deps Deps) ([]store.CorpusEventData, error) {
			return deps.Devtools.(runtimeEventReads).CorpusEvents(ctx), nil
		})
	LegacyIngestEvents = getSnapshot("GET /api/ingest", "runtime:snapshot", "ingestEvents",
		func(ctx context.Context, deps Deps) ([]store.IngestEventData, error) {
			return deps.Devtools.(runtimeEventReads).IngestEvents(ctx), nil
		})
	LegacyCompactEvents = getSnapshot("GET /api/compaction", "runtime:snapshot", "compactEvents",
		func(ctx context.Context, deps Deps) ([]store.CompactEventData, error) {
			return deps.Devtools.(runtimeEventReads).CompactEvents(ctx), nil
		})
	LegacyBudgetSnapshots = getSnapshot("GET /api/budget", "runtime:snapshot", "budgetSnapshots",
		func(ctx context.Context, deps Deps) ([]store.BudgetSnapshotData, error) {
			return deps.Devtools.(runtimeEventReads).BudgetSnapshots(ctx), nil
		})
	LegacyCostEvents = getSnapshot("GET /api/cost", "runtime:snapshot", "costEvents",
		func(ctx context.Context, deps Deps) ([]store.CostEventData, error) {
			return deps.Devtools.(runtimeEventReads).CostEvents(ctx), nil
		})
	LegacyAgentEvents = getSnapshot("GET /api/agent", "runtime:snapshot", "agentEvents",
		func(ctx context.Context, deps Deps) ([]store.AgentEventData, error) {
			return deps.Devtools.(runtimeEventReads).AgentEvents(ctx), nil
		})
	LegacyJudgeEvents = getSnapshot("GET /api/judges", "runtime:snapshot", "judgeEvents",
		func(ctx context.Context, deps Deps) ([]store.JudgeEventData, error) {
			return deps.Devtools.(runtimeEventReads).JudgeEvents(ctx), nil
		})
	LegacyDelegateEvents = getSnapshot("GET /api/delegates", "runtime:snapshot", "delegateEvents",
		func(ctx context.Context, deps Deps) ([]store.DelegateEventData, error) {
			return deps.Devtools.(runtimeEventReads).DelegateEvents(ctx), nil
		})
	LegacyToolEvents = getSnapshot("GET /api/tools/events", "runtime:snapshot", "toolEvents",
		func(ctx context.Context, deps Deps) ([]store.ToolEventData, error) {
			return deps.Devtools.(runtimeEventReads).ToolEvents(ctx), nil
		})
	LegacySecurityEvents = getSnapshot("GET /api/security/events", "runtime:snapshot", "securityEvents",
		func(ctx context.Context, deps Deps) ([]store.SecurityEventData, error) {
			return deps.Devtools.(runtimeEventReads).SecurityEvents(ctx), nil
		})
)

type catalogListParams struct {
	Kind string
}

func (p *catalogListParams) Parse(req readmodel.Req) error {
	p.Kind = req.Query.Get("kind")
	return nil
}

var CatalogList = readmodel.GetP[Deps, *catalogListParams, api.CatalogListV1](Registry, "GET /api/catalog",
	func() *catalogListParams { return &catalogListParams{} },
	func(ctx context.Context, deps Deps, params *catalogListParams) (api.CatalogListV1, error) {
		return deps.Catalog.CatalogList(ctx, params.Kind)
	})

var CatalogStatus = readmodel.Get(Registry, "GET /api/catalog/status",
	func(ctx context.Context, deps Deps) (api.CatalogStatusV1, error) {
		return deps.Catalog.CatalogStatus(ctx)
	})

var CatalogDefinition = readmodel.GetP[Deps, *readmodel.PathID, api.CatalogDefinitionV1](Registry, "GET /api/catalog/{definitionId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "definitionId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (api.CatalogDefinitionV1, error) {
		definition, found, err := deps.Catalog.CatalogDefinition(ctx, params.ID)
		if err != nil || found {
			return definition, err
		}
		return definition, readmodel.ErrNotFound
	})

var CatalogExplanation = readmodel.GetP[Deps, *readmodel.PathID, api.CatalogExplanationV1](Registry, "GET /api/catalog/explain/{definitionId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "definitionId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (api.CatalogExplanationV1, error) {
		explanation, found, err := deps.Catalog.CatalogExplanation(ctx, params.ID)
		if err != nil || found {
			return explanation, err
		}
		return explanation, readmodel.ErrNotFound
	})
