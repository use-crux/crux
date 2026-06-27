package endpoints

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type DevtoolsReads interface {
	ProjectIndex(context.Context) (api.IndexData, error)
	ProjectIndexWatchStatus(context.Context) (api.ProjectIndexWatchStatus, error)
}

type QualityReads interface {
	ActivityAPI(context.Context, int) ([]api.QualityActivityEvent, error)
	RunsWithOptionsAPI(context.Context, api.QualityRunsOptions) ([]api.QualityRunRecord, error)
	RunDetailAPI(context.Context, string) (api.QualityRunDetailRecord, bool, error)
	InsightsAPI(context.Context) ([]api.QualityInsightRecord, error)
	InsightSilencesAPI(context.Context, bool) ([]api.QualityInsightSilenceRecord, error)
	FeedbackAPI(context.Context) ([]api.QualityFeedbackRecord, error)
	FeedbackAnnotationsAPI(context.Context) ([]api.QualityFeedbackAnnotationRecord, error)
	MemoryProposalsAPI(context.Context) ([]api.QualityFeedbackMemoryProposalRecord, error)

	// Spec-02 read port — the canonical /api/quality/* data surface over the
	// rewritten engine's records (experiments, baselines, cassettes).
	ExperimentSummariesAPI(context.Context) ([]api.QualityExperimentSummary, error)
	ExperimentsPageAPI(context.Context, api.QualityExperimentsOptions) (api.QualityExperimentsPage, error)
	ExperimentRecordAPI(context.Context, string) (json.RawMessage, bool, error)
	BaselineRecordsAPI(context.Context) ([]json.RawMessage, error)
	BaselineRecordAPI(context.Context, string) (json.RawMessage, bool, error)
	CassetteFilesAPI(context.Context) ([]api.QualityCassetteFileRecord, error)
	OverviewRecordAPI(context.Context, ...string) (api.QualityOverviewRecord, error)
	ScorerStatsAPI(context.Context) ([]api.QualityScorerStats, error)
	ExperimentDetailAPI(context.Context, string) (api.QualityExperimentDetail, bool, error)
	PromotedBaselinesAPI(context.Context) ([]api.QualityPromotedBaseline, error)
	EvaluationExperimentsAPI(context.Context, string, int) (api.QualityEvaluationExperiments, error)
	EvaluationExperimentGroupsAPI(context.Context, int) (api.QualityEvaluationExperimentGroups, error)
	EvaluationProgressAPI(context.Context, string, int) (api.QualityEvaluationProgress, bool, error)
	CellEvidenceAPI(context.Context, api.QualityCellEvidenceQuery) (api.QualityCellEvidence, bool, error)
}

// EvaluationCollector serves the spec-02 Evaluation manifests (the
// `collect:done` output of the embedded quality worker). Wired by the server;
// nil when no project worker is available.
type EvaluationCollector interface {
	EvaluationManifests(context.Context) ([]json.RawMessage, error)
}

type Deps struct {
	Devtools DevtoolsReads
	Quality  QualityReads
	// Evaluations is optional; the evaluations endpoint reports
	// unavailability when nil.
	Evaluations EvaluationCollector
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

var QualityActivity = readmodel.GetP[Deps, *readmodel.Limit, []api.QualityActivityEvent](Registry, "GET /api/quality/activity",
	func() *readmodel.Limit { return &readmodel.Limit{} },
	func(ctx context.Context, deps Deps, params *readmodel.Limit) ([]api.QualityActivityEvent, error) {
		return deps.Quality.ActivityAPI(ctx, params.N)
	})

// --- Spec-02 canonical quality data surface ---

var QualityWorkbenchOverview = readmodel.GetP[Deps, *QualityOverviewParams, api.QualityOverviewRecord](Registry, "GET /api/quality/overview",
	func() *QualityOverviewParams { return &QualityOverviewParams{} },
	func(ctx context.Context, deps Deps, params *QualityOverviewParams) (api.QualityOverviewRecord, error) {
		return deps.Quality.OverviewRecordAPI(ctx, params.Window)
	})

var QualityExperimentSummaries = readmodel.GetP[Deps, *QualityExperimentsParams, api.QualityExperimentsPage](Registry, "GET /api/quality/experiments",
	func() *QualityExperimentsParams { return &QualityExperimentsParams{} },
	func(ctx context.Context, deps Deps, params *QualityExperimentsParams) (api.QualityExperimentsPage, error) {
		return deps.Quality.ExperimentsPageAPI(ctx, params.QualityExperimentsOptions)
	})

// QualityExperimentRecord serves one experiment record VERBATIM (the stored
// bytes): spec-02 evolves additively and a struct round-trip would drop
// fields newer than this binary.
var QualityExperimentRecord = readmodel.GetP[Deps, *readmodel.PathID, json.RawMessage](Registry, "GET /api/quality/experiments/{experimentId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "experimentId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (json.RawMessage, error) {
		record, found, err := deps.Quality.ExperimentRecordAPI(ctx, params.ID)
		if err != nil || found {
			return record, err
		}
		return record, readmodel.ErrNotFound
	})

var QualityBaselineRecords = readmodel.Get(Registry, "GET /api/quality/baselines",
	func(ctx context.Context, deps Deps) ([]json.RawMessage, error) {
		return deps.Quality.BaselineRecordsAPI(ctx)
	})

// QualityBaselineRecord is keyed by EVALUATION id (the spec-02 §3 filename
// rule: `baselines/<evaluationId>.json`), unlike the legacy baselineId param.
var QualityBaselineRecord = readmodel.GetP[Deps, *readmodel.PathID, json.RawMessage](Registry, "GET /api/quality/baselines/{evaluationId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "evaluationId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (json.RawMessage, error) {
		record, found, err := deps.Quality.BaselineRecordAPI(ctx, params.ID)
		if err != nil || found {
			return record, err
		}
		return record, readmodel.ErrNotFound
	})

var QualityCassetteFiles = readmodel.Get(Registry, "GET /api/quality/cassettes",
	func(ctx context.Context, deps Deps) ([]api.QualityCassetteFileRecord, error) {
		return deps.Quality.CassetteFilesAPI(ctx)
	})

var QualityScorerStats = readmodel.Get(Registry, "GET /api/quality/scorers",
	func(ctx context.Context, deps Deps) ([]api.QualityScorerStats, error) {
		return deps.Quality.ScorerStatsAPI(ctx)
	})

// QualityEvaluations serves the discovered evaluation manifests (spec-02 §2)
// from the embedded worker's collect output — what devtools renders before
// any run exists.
var QualityEvaluations = readmodel.Get(Registry, "GET /api/quality/evaluations",
	func(ctx context.Context, deps Deps) ([]json.RawMessage, error) {
		if deps.Evaluations == nil {
			return nil, fmt.Errorf("evaluation collector unavailable (no project worker)")
		}
		return deps.Evaluations.EvaluationManifests(ctx)
	})

var QualityEvaluationExperimentGroups = readmodel.GetP[Deps, *readmodel.Limit, api.QualityEvaluationExperimentGroups](Registry, "GET /api/quality/evaluations/experiment-groups",
	func() *readmodel.Limit { return &readmodel.Limit{Default: 20} },
	func(ctx context.Context, deps Deps, params *readmodel.Limit) (api.QualityEvaluationExperimentGroups, error) {
		return deps.Quality.EvaluationExperimentGroupsAPI(ctx, params.N)
	})

var QualityEvaluationExperiments = readmodel.GetP[Deps, *evaluationProgressParams, api.QualityEvaluationExperiments](Registry, "GET /api/quality/evaluations/{evaluationId}/experiments",
	func() *evaluationProgressParams { return &evaluationProgressParams{} },
	func(ctx context.Context, deps Deps, params *evaluationProgressParams) (api.QualityEvaluationExperiments, error) {
		return deps.Quality.EvaluationExperimentsAPI(ctx, params.EvaluationID, params.Limit)
	})

var QualityEvaluationProgress = readmodel.GetP[Deps, *evaluationProgressParams, api.QualityEvaluationProgress](Registry, "GET /api/quality/evaluations/{evaluationId}/progress",
	func() *evaluationProgressParams { return &evaluationProgressParams{} },
	func(ctx context.Context, deps Deps, params *evaluationProgressParams) (api.QualityEvaluationProgress, error) {
		record, found, err := deps.Quality.EvaluationProgressAPI(ctx, params.EvaluationID, params.Limit)
		if err != nil || found {
			return record, err
		}
		return record, readmodel.ErrNotFound
	})

var QualityInsights = readmodel.Get(Registry, "GET /api/quality/insights",
	func(ctx context.Context, deps Deps) ([]api.QualityInsightRecord, error) {
		return deps.Quality.InsightsAPI(ctx)
	})

var QualityInsightSilences = readmodel.GetP[Deps, *IncludeDeletedParams, []api.QualityInsightSilenceRecord](Registry, "GET /api/quality/insights/silences",
	func() *IncludeDeletedParams { return &IncludeDeletedParams{} },
	func(ctx context.Context, deps Deps, params *IncludeDeletedParams) ([]api.QualityInsightSilenceRecord, error) {
		return deps.Quality.InsightSilencesAPI(ctx, params.IncludeDeleted)
	})

var QualityRuns = readmodel.GetP[Deps, *RunsParams, []api.QualityRunRecord](Registry, "GET /api/quality/runs",
	func() *RunsParams { return &RunsParams{} },
	func(ctx context.Context, deps Deps, params *RunsParams) ([]api.QualityRunRecord, error) {
		return deps.Quality.RunsWithOptionsAPI(ctx, params.QualityRunsOptions)
	})

var QualityRunDetail = readmodel.GetP[Deps, *readmodel.PathID, api.QualityRunDetailRecord](Registry, "GET /api/quality/runs/{traceId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "traceId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (api.QualityRunDetailRecord, error) {
		record, found, err := deps.Quality.RunDetailAPI(ctx, params.ID)
		if err != nil || found {
			return record, err
		}
		return record, readmodel.ErrNotFound
	})

var QualityFeedback = readmodel.Get(Registry, "GET /api/quality/feedback",
	func(ctx context.Context, deps Deps) ([]api.QualityFeedbackRecord, error) {
		return deps.Quality.FeedbackAPI(ctx)
	})

var QualityFeedbackAnnotations = readmodel.Get(Registry, "GET /api/quality/feedback/annotations",
	func(ctx context.Context, deps Deps) ([]api.QualityFeedbackAnnotationRecord, error) {
		return deps.Quality.FeedbackAnnotationsAPI(ctx)
	})

var QualityMemoryProposals = readmodel.Get(Registry, "GET /api/quality/feedback/memory-proposals",
	func(ctx context.Context, deps Deps) ([]api.QualityFeedbackMemoryProposalRecord, error) {
		return deps.Quality.MemoryProposalsAPI(ctx)
	})

type evalReads interface {
	EvalRuns(context.Context) []store.EvalRun
	EvalRun(context.Context, string) (*store.EvalRun, bool)
	EvalBaseline(context.Context, string) (*store.EvalRun, bool)
	RagEvalRuns(context.Context) []store.RagEvalRun
	RagEvalRun(context.Context, string) (*store.RagEvalRun, bool)
	FlowRuns(context.Context) []store.FlowRun
	FlowRun(context.Context, string) (*store.FlowRun, bool)
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

type evaluationProgressParams struct {
	EvaluationID string
	Limit        int
}

// EvaluationIDLimitParams exposes the shared evaluation-id + limit parser for
// in-process direct clients that dispatch logical read-model routes without
// going through net/http.
type EvaluationIDLimitParams = evaluationProgressParams

func (p *evaluationProgressParams) Parse(req readmodel.Req) error {
	if req.PathValue != nil {
		p.EvaluationID = req.PathValue("evaluationId")
	}
	if p.EvaluationID == "" {
		return readmodel.BadRequest("evaluationId is required")
	}
	limit := &readmodel.Limit{Default: 20}
	if err := limit.Parse(req); err != nil {
		return err
	}
	if limit.N < 0 {
		return readmodel.BadRequest("invalid limit")
	}
	if limit.N > 100 {
		limit.N = 100
	}
	p.Limit = limit.N
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
			return deps.Devtools.(evalReads).ObservedInjection(ctx, params.N)
		})
	LegacyEvalRun = readmodel.GetP[Deps, *readmodel.PathID, *store.EvalRun](Registry, "GET /api/evals/{evalId}",
		func() *readmodel.PathID { return &readmodel.PathID{Name: "evalId"} },
		func(ctx context.Context, deps Deps, params *readmodel.PathID) (*store.EvalRun, error) {
			run, found := deps.Devtools.(evalReads).EvalRun(ctx, params.ID)
			if !found {
				return nil, readmodel.ErrNotFound
			}
			return run, nil
		})
	LegacyEvalBaseline = readmodel.GetP[Deps, *readmodel.PathID, *store.EvalRun](Registry, "GET /api/evals/baseline/{promptId}",
		func() *readmodel.PathID { return &readmodel.PathID{Name: "promptId"} },
		func(ctx context.Context, deps Deps, params *readmodel.PathID) (*store.EvalRun, error) {
			run, found := deps.Devtools.(evalReads).EvalBaseline(ctx, params.ID)
			if !found {
				return nil, readmodel.ErrNotFound
			}
			return run, nil
		})
	LegacyRagEvalRun = readmodel.GetP[Deps, *readmodel.PathID, *store.RagEvalRun](Registry, "GET /api/rag-evals/{evalId}",
		func() *readmodel.PathID { return &readmodel.PathID{Name: "evalId"} },
		func(ctx context.Context, deps Deps, params *readmodel.PathID) (*store.RagEvalRun, error) {
			run, found := deps.Devtools.(evalReads).RagEvalRun(ctx, params.ID)
			if !found {
				return nil, readmodel.ErrNotFound
			}
			return run, nil
		})
	LegacyFlowRun = readmodel.GetP[Deps, *readmodel.PathID, *store.FlowRun](Registry, "GET /api/flows/{flowId}",
		func() *readmodel.PathID { return &readmodel.PathID{Name: "flowId"} },
		func(ctx context.Context, deps Deps, params *readmodel.PathID) (*store.FlowRun, error) {
			run, found := deps.Devtools.(evalReads).FlowRun(ctx, params.ID)
			if !found {
				return nil, readmodel.ErrNotFound
			}
			return run, nil
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
	LegacyEvals = getSnapshot("GET /api/evals", "eval:snapshot", "evalRuns",
		func(ctx context.Context, deps Deps) ([]store.EvalRun, error) {
			return deps.Devtools.(evalReads).EvalRuns(ctx), nil
		})
	LegacyRagEvals = getSnapshot("GET /api/rag-evals", "rag-eval:snapshot", "ragEvalRuns",
		func(ctx context.Context, deps Deps) ([]store.RagEvalRun, error) {
			return deps.Devtools.(evalReads).RagEvalRuns(ctx), nil
		})
	LegacyFlows = getSnapshot("GET /api/flows", "flow:snapshot", "flowRuns",
		func(ctx context.Context, deps Deps) ([]store.FlowRun, error) {
			return deps.Devtools.(evalReads).FlowRuns(ctx), nil
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
