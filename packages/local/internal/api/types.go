package api

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

// API response types mirroring the TypeScript store types from server/store.ts.

// TokenUsage tracks input/output token counts and cache statistics.
type TokenUsage struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
	CacheReads   int `json:"cacheReadInputTokens,omitempty"`
	CacheWrites  int `json:"cacheCreationInputTokens,omitempty"`
}

// InspectTraceRecord is the bounded trace summary included in an Inspect detail
// response. Normal inspection truth lives in ObservabilityRunDetail; raw graph
// access is reserved for explicit export/debug flows.
type InspectTraceRecord struct {
	TraceID    string          `json:"traceId"`
	PromptID   *string         `json:"promptId,omitempty"`
	StartedAt  int64           `json:"startedAt"`
	Input      map[string]any  `json:"input,omitempty"`
	Model      string          `json:"model,omitempty"`
	Provider   string          `json:"provider,omitempty"`
	DurationMs *float64        `json:"durationMs,omitempty"`
	Status     string          `json:"status,omitempty"`
	Result     json.RawMessage `json:"result,omitempty"`
	Error      json.RawMessage `json:"error,omitempty"`
	SessionID  string          `json:"sessionId,omitempty"`
}

type ObservabilityRunSummary = observability.RunSummary
type ObservabilityRunsPage = observability.RunsResponse
type ObservabilityGraph = observability.Graph
type ObservabilityRunDetail = observability.RunDetail
type ObservabilityRunDetailNode = observability.RunDetailNode
type ObservabilityRunDetailDetail = observability.RunDetailDetail
type ObservabilityRunDetailRow = observability.RunDetailRow
type ObservabilityRunDetailInspection = observability.RunDetailInspection
type ObservabilityRunDetailInspectionItem = observability.RunDetailInspectionItem
type ObservabilitySpanSummary = observability.SpanSummary
type ObservabilitySpanEventSummary = observability.SpanEventSummary
type ObservabilityArtifactSummary = observability.ArtifactSummary
type ObservabilityEdgeSummary = observability.EdgeSummary
type ObservabilityStoredRecord = observability.StoredRecord
type ObservabilityResourceActivity = observability.ResourceActivity
type ObservabilityResourceArtifact = observability.ResourceArtifact

// CorrelatedEvent is a generic event tied to a trace via traceId.
type CorrelatedEvent struct {
	Kind      string         `json:"-"` // Derived from eventType or _kind
	Timestamp int64          `json:"timestamp"`
	Data      map[string]any `json:"-"` // The nested data object
	Raw       map[string]any `json:"-"` // Full raw event
}

// CostEvent represents a cost:report, cost:warn, or cost:limit event.
type CostEvent struct {
	Kind      string         `json:"_kind"`
	TraceID   string         `json:"traceId,omitempty"`
	SessionID string         `json:"sessionId,omitempty"`
	Timestamp int64          `json:"timestamp"`
	Threshold *float64       `json:"threshold,omitempty"`
	Actual    *float64       `json:"actual,omitempty"`
	Entry     map[string]any `json:"entry,omitempty"`
	Report    map[string]any `json:"report,omitempty"`
}

// CorpusEvent represents corpus sync and per-source events.
type CorpusEvent struct {
	Kind        string   `json:"_kind"`
	Type        string   `json:"type,omitempty"`
	SyncID      string   `json:"syncId"`
	CorpusID    string   `json:"corpusId"`
	Namespace   string   `json:"namespace"`
	Mode        string   `json:"mode,omitempty"`
	StalePolicy string   `json:"stalePolicy,omitempty"`
	SourceSet   string   `json:"sourceSet,omitempty"`
	DryRun      bool     `json:"dryRun"`
	SourceCount *int     `json:"sourceCount,omitempty"`
	SourceID    string   `json:"sourceId,omitempty"`
	Action      string   `json:"action,omitempty"`
	Reason      string   `json:"reason,omitempty"`
	ChunkCount  *int     `json:"chunkCount,omitempty"`
	Added       *int     `json:"added,omitempty"`
	Changed     *int     `json:"changed,omitempty"`
	Unchanged   *int     `json:"unchanged,omitempty"`
	Stale       *int     `json:"stale,omitempty"`
	Skipped     *int     `json:"skipped,omitempty"`
	Deleted     *int     `json:"deleted,omitempty"`
	Failed      *int     `json:"failed,omitempty"`
	DurationMs  *float64 `json:"durationMs,omitempty"`
	Error       *string  `json:"error,omitempty"`
	TraceID     string   `json:"traceId,omitempty"`
	SessionID   string   `json:"sessionId,omitempty"`
	Timestamp   int64    `json:"timestamp"`
}

// IngestEvent represents ingest parser start/end events.
type IngestEvent struct {
	Kind         string   `json:"_kind"`
	TraceID      string   `json:"traceId,omitempty"`
	SessionID    string   `json:"sessionId,omitempty"`
	Timestamp    int64    `json:"timestamp"`
	IngestID     string   `json:"ingestId"`
	Parser       string   `json:"parser"`
	Format       string   `json:"format"`
	Namespace    string   `json:"namespace"`
	SourceID     string   `json:"sourceId"`
	ByteLength   int      `json:"byteLength"`
	ContentType  string   `json:"contentType,omitempty"`
	DurationMs   *float64 `json:"durationMs,omitempty"`
	PartCount    *int     `json:"partCount,omitempty"`
	WarningCount *int     `json:"warningCount,omitempty"`
	Error        *string  `json:"error,omitempty"`
}

// UnmarshalJSON captures all fields into Raw and extracts Kind/Data.
func (e *CorrelatedEvent) UnmarshalJSON(data []byte) error {
	if err := json.Unmarshal(data, &e.Raw); err != nil {
		return err
	}
	// Kind: try eventType first (store format), then _kind (protocol format).
	if et, ok := e.Raw["eventType"].(string); ok {
		e.Kind = et
	} else if k, ok := e.Raw["_kind"].(string); ok {
		e.Kind = k
	}
	if ts, ok := e.Raw["timestamp"].(float64); ok {
		e.Timestamp = int64(ts)
	}
	// Data: nested data object (store format) or top-level fields (protocol format).
	if d, ok := e.Raw["data"].(map[string]any); ok {
		e.Data = d
	} else {
		e.Data = e.Raw
	}
	return nil
}

// GetString extracts a string field from the event data.
func (e *CorrelatedEvent) GetString(key string) string {
	if v, ok := e.Data[key].(string); ok {
		return v
	}
	return ""
}

// GetFloat extracts a float field from the event data.
func (e *CorrelatedEvent) GetFloat(key string) (float64, bool) {
	if v, ok := e.Data[key].(float64); ok {
		return v, true
	}
	return 0, false
}

// GetInt extracts an int field from the event data.
func (e *CorrelatedEvent) GetInt(key string) (int, bool) {
	if v, ok := e.Data[key].(float64); ok {
		return int(v), true
	}
	return 0, false
}

// Stats holds aggregate statistics across all traces.
type Stats struct {
	TotalExecutions          int      `json:"totalExecutions"`
	SuccessCount             int      `json:"successCount"`
	ErrorCount               int      `json:"errorCount"`
	RunningCount             int      `json:"runningCount"`
	AvgDurationMs            float64  `json:"avgDurationMs"`
	TotalCost                float64  `json:"totalCost"`
	AvgCost                  float64  `json:"avgCost"`
	TotalTokens              int      `json:"totalTokens"`
	ErrorRate                float64  `json:"errorRate"`
	MemoryReadCount          int      `json:"memoryReadCount"`
	MemoryWriteCount         int      `json:"memoryWriteCount"`
	CompactionCount          int      `json:"compactionCount"`
	BudgetLevel              *string  `json:"budgetLevel"`
	JudgeAvgScore            *float64 `json:"judgeAvgScore"`
	AvgTtftMs                *float64 `json:"avgTtftMs"`
	AvgThroughput            *float64 `json:"avgThroughput"`
	StreamingTraceCount      int      `json:"streamingTraceCount"`
	HandoffCount             int      `json:"handoffCount"`
	BlackboardUpdateCount    int      `json:"blackboardUpdateCount"`
	DelegateCount            int      `json:"delegateCount"`
	ToolExecutionCount       int      `json:"toolExecutionCount"`
	ToolApprovalRequestCount int      `json:"toolApprovalRequestCount"`
	ToolApprovalDeniedCount  int      `json:"toolApprovalDeniedCount"`
	ToolErrorCount           int      `json:"toolErrorCount"`
	ToolTokenSavingsEstimate int      `json:"toolTokenSavingsEstimate"`
	SecurityWarningCount     int      `json:"securityWarningCount"`
	ContextCacheHitCount     int      `json:"contextCacheHitCount"`
	ContextCacheMissCount    int      `json:"contextCacheMissCount"`
	ContextCacheHitRate      *float64 `json:"contextCacheHitRate"`
	SemanticCacheHitCount    int      `json:"semanticCacheHitCount"`
	SemanticCacheMissCount   int      `json:"semanticCacheMissCount"`
	SemanticCacheWriteCount  int      `json:"semanticCacheWriteCount"`
	SemanticCacheHitRate     *float64 `json:"semanticCacheHitRate"`
	EmbeddingCallCount       int      `json:"embeddingCallCount"`
	TotalEmbeddingTexts      int      `json:"totalEmbeddingTexts"`
	AvgEmbeddingDurationMs   *float64 `json:"avgEmbeddingDurationMs"`
	TotalEmbeddingTokens     int      `json:"totalEmbeddingTokens"`
	TotalEmbeddingCost       float64  `json:"totalEmbeddingCost"`
	EmbeddingCacheHitCount   int      `json:"embeddingCacheHitCount"`
	EmbeddingCacheMissCount  int      `json:"embeddingCacheMissCount"`
	EmbeddingRetryCount      int      `json:"embeddingRetryCount"`
	EmbeddingTruncatedCount  int      `json:"embeddingTruncatedCount"`
	EmbeddingRateLimitWaitMs float64  `json:"embeddingRateLimitWaitMs"`
	RetrievalCallCount       int      `json:"retrievalCallCount"`
	RetrievalErrorCount      int      `json:"retrievalErrorCount"`
	AvgRetrievalDurationMs   *float64 `json:"avgRetrievalDurationMs"`
	TotalRetrievedHits       int      `json:"totalRetrievedHits"`
	RetrievalStageCount      int      `json:"retrievalStageCount"`
	RetrievalStageErrorCount int      `json:"retrievalStageErrorCount"`
	WorkspaceOperationCount  int      `json:"workspaceOperationCount"`
	WorkspaceErrorCount      int      `json:"workspaceErrorCount"`
	IndexOperationCount      int      `json:"indexOperationCount"`
	IndexErrorCount          int      `json:"indexErrorCount"`
	AvgIndexDurationMs       *float64 `json:"avgIndexDurationMs"`
	TotalIndexedSources      int      `json:"totalIndexedSources"`
	TotalIndexedChunks       int      `json:"totalIndexedChunks"`
	IngestParseCount         int      `json:"ingestParseCount"`
	IngestErrorCount         int      `json:"ingestErrorCount"`
	AvgIngestDurationMs      *float64 `json:"avgIngestDurationMs"`
	TotalIngestParts         int      `json:"totalIngestParts"`
	TotalIngestWarnings      int      `json:"totalIngestWarnings"`
}

// CompositionKindStats holds per-kind composition metrics.
type CompositionKindStats struct {
	Total         int     `json:"total"`
	Success       int     `json:"success"`
	Error         int     `json:"error"`
	AvgDurationMs float64 `json:"avgDurationMs"`
	AvgAgents     float64 `json:"avgAgents"`
}

// SwarmAnalytics holds swarm-specific aggregate metrics.
type SwarmAnalytics struct {
	AvgHandoffs float64 `json:"avgHandoffs"`
	TopPaths    []struct {
		Path  string `json:"path"`
		Count int    `json:"count"`
	} `json:"topPaths"`
	AgentBottleneck *struct {
		AgentID       string  `json:"agentId"`
		AvgDurationMs float64 `json:"avgDurationMs"`
	} `json:"agentBottleneck"`
}

// CompositionStats holds aggregated composition analytics.
type CompositionStats struct {
	ByKind map[string]CompositionKindStats `json:"byKind"`
	Swarm  *SwarmAnalytics                 `json:"swarm"`
}

// InspectOverviewRecord is the Inspect dashboard projection for observability
// runs and derived insight tallies.
type InspectOverviewRecord struct {
	Tag                       string              `json:"_tag"`
	RunCount                  int                 `json:"runCount"`
	SkippedRecords            int                 `json:"skippedRecords,omitempty"`
	InsightCount              int                 `json:"insightCount"`
	PassRate                  *float64            `json:"passRate,omitempty"`
	MeanScore                 *float64            `json:"meanScore,omitempty"`
	TotalCost                 float64             `json:"totalCost"`
	P50LatencyMs              *float64            `json:"p50LatencyMs,omitempty"`
	P95LatencyMs              *float64            `json:"p95LatencyMs,omitempty"`
	CostPer100Runs            *float64            `json:"costPer100Runs,omitempty"`
	PassRateHistory           []float64           `json:"passRateHistory"`
	OpenInsightsHistory       []int               `json:"openInsightsHistory"`
	PassRateSpark             []float64           `json:"passRateSpark"`
	CostSpark                 []float64           `json:"costSpark"`
	LatencySpark              []float64           `json:"latencySpark"`
	OpenInsightSeverityCounts map[string]int      `json:"openInsightSeverityCounts,omitempty"`
	RunTabCounts              InspectRunTabCounts `json:"runTabCounts"`
	RecentRuns                []InspectRunRecord  `json:"recentRuns,omitempty"`
}

type InspectRunTabCounts struct {
	All      int `json:"all"`
	Live     int `json:"live"`
	Failures int `json:"failures"`
}

type InspectEvent struct {
	Tag       string          `json:"_tag"`
	ID        string          `json:"id"`
	Timestamp int64           `json:"timestamp"`
	Kind      string          `json:"kind"`
	Action    string          `json:"action"`
	Severity  string          `json:"severity"`
	RefID     string          `json:"refId"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type InspectActivityEvent struct {
	Tag       string `json:"_tag"`
	Timestamp int64  `json:"timestamp"`
	Kind      string `json:"kind"`
	Severity  string `json:"severity"`
	Summary   string `json:"summary"`
	RefID     string `json:"refId"`
}

type DevtoolsContext struct {
	Project struct {
		Name string `json:"name"`
		Path string `json:"path"`
	} `json:"project"`
	Git struct {
		Branch    string `json:"branch,omitempty"`
		CommitSHA string `json:"commitSha,omitempty"`
		Dirty     bool   `json:"dirty,omitempty"`
	} `json:"git"`
	Target struct {
		ID    string `json:"id"`
		Kind  string `json:"kind"`
		Model string `json:"model,omitempty"`
	} `json:"target"`
	Baseline struct {
		ID                 string `json:"id,omitempty"`
		Label              string `json:"label,omitempty"`
		PromotedAtRelative string `json:"promotedAtRelative,omitempty"`
	} `json:"baseline"`
	Version string `json:"version"`
}

type InspectRunRecord struct {
	Tag           string         `json:"_tag"`
	OperationID   string         `json:"operationId,omitempty"`
	TraceID       string         `json:"traceId"`
	TargetID      string         `json:"targetId,omitempty"`
	PromptID      *string        `json:"promptId,omitempty"`
	FlowID        string         `json:"flowId,omitempty"`
	ParentRunID   string         `json:"parentRunId,omitempty"`
	RootPrimitive string         `json:"rootPrimitive,omitempty"`
	Kind          string         `json:"kind,omitempty"`
	Status        string         `json:"status"`
	StartedAt     int64          `json:"startedAt"`
	DurationMs    *float64       `json:"durationMs,omitempty"`
	Model         string         `json:"model,omitempty"`
	Provider      string         `json:"provider,omitempty"`
	Input         map[string]any `json:"input,omitempty"`
	Output        any            `json:"output,omitempty"`
	Error         any            `json:"error,omitempty"`
	Usage         any            `json:"usage,omitempty"`
	Cost          *float64       `json:"cost,omitempty"`
	TokenCount    int            `json:"tokenCount,omitempty"`
	Score         *float64       `json:"score,omitempty"`
	ScoreName     string         `json:"scoreName,omitempty"`
	ToolCallCount int            `json:"toolCallCount"`
	SpanCount     int            `json:"spanCount,omitempty"`
	ChildCount    int            `json:"childCount,omitempty"`
	// TraceCount is the number of traces in this run (1 for a standalone
	// trace, N for a flow/pipeline that spawned N child traces). The detail
	// view stitches all of them into one span tree.
	TraceCount int `json:"traceCount,omitempty"`
	// SessionID is metadata only — sourced from the root trace, used by
	// frontends as a `groupBy` axis on the runs list and as a filter
	// (`?session=` on the runs endpoint). It does NOT participate in
	// run-grouping; that's purely structural (parent / flow / time-window
	// overlap).
	SessionID             string   `json:"sessionId,omitempty"`
	DiagnosticCount       int      `json:"diagnosticsCount,omitempty"`
	DiagnosticMaxSeverity string   `json:"diagnosticsMaxSeverity,omitempty"`
	DiagnosticCodes       []string `json:"diagnosticCodes,omitempty"`
}

type InspectRunDetailRecord struct {
	Tag       string                     `json:"_tag"`
	Run       InspectRunRecord           `json:"run"`
	Trace     InspectTraceRecord         `json:"trace"`
	Events    []CorrelatedEvent          `json:"events"`
	Spans     []InspectRunSpan           `json:"spans"`
	Narrative []InspectRunNarrativeEvent `json:"narrative"`
}

type InspectDeleteRunsRequest struct {
	OperationIDs []string `json:"operationIds"`
}

type InspectDeleteRunsRecord struct {
	Tag                 string   `json:"_tag"`
	OperationIDs        []string `json:"operationIds"`
	DeletedOperationIDs []string `json:"deletedOperationIds"`
	MissingOperationIDs []string `json:"missingOperationIds"`
}

// InspectRunSpan is one node in a Run's execution tree. The Primitive
// field is a closed taxonomy mapping to a @use-crux/core primitive so the UI
// can pick a color/glyph/attributes-layout without reverse-engineering
// the EventType string. CompositionType is set only when Primitive is
// "composition" (the kind: pipeline | parallel | consensus | swarm).
type InspectRunSpan struct {
	ID                string   `json:"id"`
	ParentID          string   `json:"parentId,omitempty"`
	Kind              string   `json:"kind"`
	Op                string   `json:"op"`
	Primitive         string   `json:"primitive"`
	CompositionType   string   `json:"compositionType,omitempty"`
	Name              string   `json:"name"`
	Status            string   `json:"status"`
	StartedAt         int64    `json:"startedAt,omitempty"`
	EndedAt           int64    `json:"endedAt,omitempty"`
	DurationMs        *float64 `json:"durationMs,omitempty"`
	TokenCount        int      `json:"tokenCount,omitempty"`
	Cost              *float64 `json:"cost,omitempty"`
	EventType         string   `json:"eventType,omitempty"`
	Duplicate         bool     `json:"duplicate"`
	DuplicateOfSpanID string   `json:"duplicateOfSpanId,omitempty"`
	// Attributes is a flat string projection of Data, suitable for the
	// quick `key: value` rendering panes use. Large or nested values are
	// truncated/coerced to strings — when the UI needs full fidelity
	// (e.g. tool args, generation messages, retrieval hits, consensus
	// vote payload) it should consume `Data` instead.
	Attributes map[string]string `json:"attributes,omitempty"`
	// Data carries the full primitive-specific payload as opaque JSON —
	// for paired primitives (tool/flow/composition/…) it's the merged
	// start+end event data; for leaf events it's the single event's
	// data. The shape is primitive-dependent; consumers should switch
	// on `primitive` to interpret it. See SpanPrimitive* for the
	// canonical layouts.
	Data json.RawMessage `json:"data,omitempty"`
	// Error carries the normalized observed failure for this span. It is
	// intentionally separate from Data so the TUI and devtools can surface
	// failure state without reverse-engineering primitive payloads.
	Error      json.RawMessage                  `json:"error,omitempty"`
	Inspection ObservabilityRunDetailInspection `json:"inspection,omitempty"`
	// Timings carries optional sub-event timing useful for replay and
	// stream visualizations. Populated when the underlying primitive
	// records it (currently: streaming generations).
	Timings          *InspectSpanTimings `json:"timings,omitempty"`
	LinkedInsightIDs []string            `json:"linkedInsightIds,omitempty"`
}

// InspectSpanTimings holds detailed timing breakdowns that go
// beyond a single start/end pair. All fields are optional; absent means
// the primitive doesn't record that signal.
type InspectSpanTimings struct {
	// TTFTMs is the time-to-first-token for streaming generations.
	TTFTMs *float64 `json:"ttftMs,omitempty"`
	// ChunksReceived is the count of streamed chunks observed.
	ChunksReceived int `json:"chunksReceived,omitempty"`
	// TotalChunks is the final chunk count for completed streams.
	TotalChunks *int `json:"totalChunks,omitempty"`
	// TokensPerSecond is the streaming throughput (post-completion).
	TokensPerSecond *float64 `json:"tokensPerSecond,omitempty"`
	// Retries is the number of retry attempts before success or failure.
	Retries int `json:"retries,omitempty"`
	// SelfMs is the duration excluding children (when computable from
	// the span tree). Useful for hotspot identification.
	SelfMs *float64 `json:"selfMs,omitempty"`
}

// InspectSpanPrimitive enumerates the canonical primitives that can
// appear in a Run's span tree. Frontends should treat anything outside
// this set as "other".
//
// Keep this list in lock-step with internal/inspect primitive classification
// classifyPrimitive() and with packages/devtools/ui/src/types.ts.
const (
	SpanPrimitiveRun                  = "run"
	SpanPrimitiveGenerationCall       = "generation.call"
	SpanPrimitiveGenerationStream     = "generation.stream"
	SpanPrimitivePromptResolve        = "prompt.resolve"
	SpanPrimitivePromptBudget         = "prompt.budget"
	SpanPrimitiveContextResolve       = "context.resolve"
	SpanPrimitiveContextPredicate     = "context.predicate"
	SpanPrimitiveContextCache         = "context.cache"
	SpanPrimitiveAgentRun             = "agent.run"
	SpanPrimitiveFlowRun              = "flow.run"
	SpanPrimitiveCompositionParallel  = "composition.parallel"
	SpanPrimitiveCompositionPipeline  = "composition.pipeline"
	SpanPrimitiveCompositionConsensus = "composition.consensus"
	SpanPrimitiveCompositionSwarm     = "composition.swarm"
	SpanPrimitiveCompositionBranch    = "composition.branch"
	SpanPrimitiveCompositionJoin      = "composition.join"
	SpanPrimitiveCompositionVote      = "composition.vote"
	SpanPrimitiveToolCall             = "tool.call"
	SpanPrimitiveToolApproval         = "tool.approval"
	SpanPrimitiveRetrievalQuery       = "retrieval.query"
	SpanPrimitiveEmbeddingCall        = "embedding.call"
	SpanPrimitiveMemoryRead           = "memory.read"
	SpanPrimitiveMemoryWrite          = "memory.write"
	SpanPrimitiveConstraintCheck      = "constraint.check"
	SpanPrimitiveConstraintRetry      = "constraint.retry"
	SpanPrimitiveGuardrailRun         = "guardrail.run"
	SpanPrimitiveRoutingRouter        = "routing.router"
	SpanPrimitiveRoutingSplit         = "routing.split"
	SpanPrimitiveRoutingRetry         = "routing.retry"
	SpanPrimitiveRoutingFallback      = "routing.fallback"
	SpanPrimitiveRoutingCascade       = "routing.cascade"
	SpanPrimitiveFallbackAttempt      = "fallback.attempt"
	SpanPrimitiveCacheLookup          = "cache.lookup"
	SpanPrimitiveCompactionRun        = "compaction.run"
	SpanPrimitiveEvalRun              = "eval.run"
	SpanPrimitiveEvalCase             = "eval.case"
	SpanPrimitiveScoringJudge         = "scoring.judge"
	SpanPrimitiveCitationCheck        = "citation.check"
	SpanPrimitiveHandoffPrepare       = "handoff.prepare"
	SpanPrimitiveDelegateInvoke       = "delegate.invoke"
	SpanPrimitiveWorkspaceOperation   = "workspace.operation"
	SpanPrimitiveThreadOperation      = "thread.operation"
	SpanPrimitiveSessionTurn          = "session.turn"
	SpanPrimitivePlanOperation        = "plan.operation"
	SpanPrimitiveTaskOperation        = "task.operation"
	SpanPrimitiveIndexingPipeline     = "indexing.pipeline"
	SpanPrimitiveIngestParse          = "ingest.parse"
	SpanPrimitiveCorpusSync           = "corpus.sync"
	SpanPrimitiveSkillLoad            = "skill.load"
	SpanPrimitiveSecurityWarning      = "security.warning"
	SpanPrimitiveCostRecord           = "cost.record"
	SpanPrimitiveFeedbackRecord       = "feedback.record"
	SpanPrimitiveCustomOperation      = "custom.operation"
	// Compact display aliases used by the TUI.
	SpanPrimitiveTrace          = "trace"           // root LLM/agent invocation
	SpanPrimitiveGeneration     = "generation"      // LLM call (leaf)
	SpanPrimitiveTool           = "tool"            // tool invocation
	SpanPrimitiveFlow           = "flow"            // runtime-flow boundary
	SpanPrimitiveFlowStep       = "flow.step"       // step inside a runtime-flow
	SpanPrimitivePipeline       = "pipeline"        // composition: pipeline
	SpanPrimitiveParallel       = "parallel"        // composition: parallel
	SpanPrimitiveConsensus      = "consensus"       // composition: consensus
	SpanPrimitiveSwarm          = "swarm"           // composition: peer swarm
	SpanPrimitiveAgent          = "agent"           // agent inside a composition
	SpanPrimitiveDelegate       = "delegate"        // agent-as-tool delegation
	SpanPrimitiveHandoff        = "handoff"         // agent handoff
	SpanPrimitiveRetrieval      = "retrieval"       // retriever call
	SpanPrimitiveRetrievalStage = "retrieval.stage" // one stage of a retriever
	SpanPrimitiveEmbed          = "embed"           // embedding call
	SpanPrimitiveJudge          = "judge"           // scorer / judge
	SpanPrimitivePlan           = "plan"            // plan create / update
	SpanPrimitiveTask           = "task"            // task list event
	SpanPrimitiveMemory         = "memory"          // memory read / write
	SpanPrimitiveBlackboard     = "blackboard"      // blackboard update
	SpanPrimitiveCompact        = "compact"         // context compaction
	SpanPrimitiveIndex          = "index"           // index build
	SpanPrimitiveIngest         = "ingest"          // doc ingest
	SpanPrimitiveCorpus         = "corpus"          // corpus sync
	SpanPrimitiveCache          = "cache"           // semantic / context cache
	SpanPrimitiveSkill          = "skill"           // skill resolve / cache
	SpanPrimitiveCost           = "cost"            // cost report / warn / limit
	SpanPrimitiveSecurity       = "security"        // security warning
	SpanPrimitiveBudget         = "budget"          // budget check
	SpanPrimitiveOther          = "other"           // catch-all
)

type InspectRunNarrativeEvent struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	Label     string         `json:"label"`
	Timestamp int64          `json:"timestamp"`
	OffsetMs  int64          `json:"offsetMs"`
	Data      map[string]any `json:"data,omitempty"`
}

type InspectInsightRecord struct {
	Tag                  string                     `json:"_tag"`
	InsightID            string                     `json:"insightId"`
	Title                string                     `json:"title"`
	Severity             string                     `json:"severity"`
	Tags                 []string                   `json:"tags"`
	Summary              string                     `json:"summary"`
	TargetID             string                     `json:"targetId,omitempty"`
	LinkedTraceIDs       []string                   `json:"linkedTraceIds,omitempty"`
	LinkedCaseIDs        []string                   `json:"linkedCaseIds,omitempty"`
	LinkedDefinitionIDs  []string                   `json:"linkedDefinitionIds,omitempty"`
	LinkedSources        []SourceLoc                `json:"linkedSources,omitempty"`
	SuspectedCause       string                     `json:"suspectedCause,omitempty"`
	ProposedFix          string                     `json:"proposedFix,omitempty"`
	OccurrenceCount      int                        `json:"occurrenceCount"`
	Trend                []float64                  `json:"trend"`
	ProposedFixConfig    *InspectInsightFixConfig   `json:"proposedFixConfig,omitempty"`
	DetailStats          *InspectInsightDetailStats `json:"detailStats,omitempty"`
	Status               string                     `json:"status"`
	UpdatedAt            string                     `json:"updatedAt,omitempty"`
	ResolvedAt           string                     `json:"resolvedAt,omitempty"`
	ResolvedOccurrences  int                        `json:"resolvedOccurrences,omitempty"`
	ReopenedAt           string                     `json:"reopenedAt,omitempty"`
	PreviousResolutionAt string                     `json:"previousResolutionAt,omitempty"`
}

type InspectInsightFixConfig struct {
	YAML       string   `json:"yaml,omitempty"`
	ConfigKeys []string `json:"configKeys,omitempty"`
}

type InspectInsightDetailStats struct {
	TokensPerRun           float64   `json:"tokensPerRun"`
	TokensSpark            []float64 `json:"tokensSpark"`
	TokensDeltaVsBaseline  string    `json:"tokensDeltaVsBaseline"`
	LatencyP95Ms           float64   `json:"latencyP95Ms"`
	LatencySpark           []float64 `json:"latencySpark"`
	LatencyDeltaVsBaseline string    `json:"latencyDeltaVsBaseline"`
	CostPer100             float64   `json:"costPer100"`
	CostSpark              []float64 `json:"costSpark"`
	CostDeltaVsBaseline    string    `json:"costDeltaVsBaseline"`
}

type InspectInsightStatusRecord struct {
	Tag                 string  `json:"_tag"`
	InsightID           string  `json:"insightId"`
	Status              string  `json:"status"`
	Note                *string `json:"note,omitempty"`
	UpdatedAt           string  `json:"updatedAt"`
	ResolvedAt          string  `json:"resolvedAt,omitempty"`
	ResolvedOccurrences int     `json:"resolvedOccurrences,omitempty"`
}

type InspectInsightSilencePattern struct {
	Title    string `json:"title"`
	TargetID string `json:"targetId,omitempty"`
}

type InspectInsightSilenceRequest struct {
	InsightID *string                       `json:"insightId,omitempty"`
	Pattern   *InspectInsightSilencePattern `json:"pattern,omitempty"`
	Note      *string                       `json:"note,omitempty"`
}

type InspectInsightSilenceRecord struct {
	Tag       string                       `json:"_tag"`
	ID        string                       `json:"id"`
	Pattern   InspectInsightSilencePattern `json:"pattern"`
	Note      *string                      `json:"note,omitempty"`
	CreatedAt string                       `json:"createdAt"`
	DeletedAt string                       `json:"deletedAt,omitempty"`
}

// InspectRunsOptions parameterizes `/api/inspect/runs`. Every field is
// optional — zero values mean "no filter / default". Mirrored in the
// HTTP layer's query-string parser so both the in-process DirectClient
// and remote HTTP consumers see the same surface.
type InspectRunsOptions struct {
	// Status filters on run-level aggregate status. Multiple values are
	// OR'd ("running,error" returns both).
	Status []string `json:"status,omitempty"`
	// Target filters by the run's TargetID (flow name / prompt id /
	// agent name). Exact match; multiple values OR'd.
	Target []string `json:"target,omitempty"`
	// Kind filters by the server-derived run kind (composition, agent,
	// flow, generation, retrieval, eval, operation). Multiple values OR'd.
	Kind []string `json:"kind,omitempty"`
	// Model filters by the model surfaced on the run row. Multiple
	// values OR'd.
	Model []string `json:"model,omitempty"`
	// Primitive filters by the root span's primitive (generation, flow,
	// pipeline, swarm, …). Multiple values OR'd.
	Primitive []string `json:"primitive,omitempty"`
	// Session filters by exact SessionID match. Multiple values OR'd.
	// Useful for the web UI's "group/filter by session" affordance.
	Session []string `json:"session,omitempty"`
	// Since / Until are unix-ms timestamp bounds on StartedAt. Zero
	// means unbounded on that side.
	Since int64 `json:"since,omitempty"`
	Until int64 `json:"until,omitempty"`
	// Search is a case-insensitive substring match against TargetID,
	// TraceID, and the run's input (stringified). Empty means no filter.
	Search string `json:"search,omitempty"`
	// Sort field: "time" (default), "duration", "cost", "tokens".
	Sort string `json:"sort,omitempty"`
	// Order: "asc" or "desc" (default). Ignored for sort=time which is
	// always desc (newest first).
	Order string `json:"order,omitempty"`
	// Limit caps the result count. 0 means no limit (server default may
	// still apply).
	Limit int `json:"limit,omitempty"`
	// Offset for pagination. 0 means start at the top.
	Offset int `json:"offset,omitempty"`
}

// InspectInsightStatusRequest is the body of `POST /api/inspect/insights/{id}/status`.
type InspectInsightStatusRequest struct {
	Status string  `json:"status"`
	Note   *string `json:"note,omitempty"`
}

// IndexData holds all registered prompts, contexts, and tools.
type IndexData struct {
	ProjectRoot     string                   `json:"projectRoot"`
	ServerVersion   string                   `json:"serverVersion"`
	Generation      uint64                   `json:"generation"`
	SchemaVersion   int                      `json:"schemaVersion,omitempty"`
	Prompts         []PromptMeta             `json:"prompts"`
	Contexts        []ContextMeta            `json:"contexts"`
	Tools           []ToolMeta               `json:"tools"`
	Project         *ProjectIdentity         `json:"project,omitempty"`
	Lint            *IndexLintConfig         `json:"lint,omitempty"`
	IndexedAt       string                   `json:"indexedAt,omitempty"`
	Indexing        *ProjectIndexingStatus   `json:"indexing,omitempty"`
	SourceGraph     *ProjectIndexSourceGraph `json:"sourceGraph,omitempty"`
	Definitions     []ProjectDefinition      `json:"definitions,omitempty"`
	Relations       []ProjectRelation        `json:"relations,omitempty"`
	Diagnostics     []IndexDiagnostic        `json:"diagnostics,omitempty"`
	LintFindings    []IndexLintFinding       `json:"lintFindings,omitempty"`
	RuleDescriptors []IndexRuleDescriptor    `json:"ruleDescriptors,omitempty"`
	Sources         []IndexSourceFile        `json:"sources,omitempty"`
}

type ProjectIndexSourceGraph struct {
	SchemaVersion int      `json:"schemaVersion"`
	ProducedBy    string   `json:"producedBy"`
	Capabilities  []string `json:"capabilities"`
}

type IndexIndexingPhaseStatus struct {
	Status           string `json:"status"`
	IndexedAt        string `json:"indexedAt,omitempty"`
	DurationMs       int64  `json:"durationMs,omitempty"`
	FileCount        int    `json:"fileCount,omitempty"`
	ChangedFileCount int    `json:"changedFileCount,omitempty"`
	DiagnosticCount  int    `json:"diagnosticCount,omitempty"`
	Error            string `json:"error,omitempty"`
}

type IndexIndexingSemanticStatus struct {
	Status                  string `json:"status"`
	Backend                 string `json:"backend,omitempty"`
	IndexedAt               string `json:"indexedAt,omitempty"`
	DurationMs              int64  `json:"durationMs,omitempty"`
	FileCount               int    `json:"fileCount,omitempty"`
	ChangedFileCount        int    `json:"changedFileCount,omitempty"`
	DiagnosticCount         int    `json:"diagnosticCount,omitempty"`
	EnrichedDefinitionCount int    `json:"enrichedDefinitionCount,omitempty"`
}

type IndexIndexingCacheStatus struct {
	Status        string `json:"status"`
	LoadedAt      string `json:"loadedAt,omitempty"`
	SnapshotAgeMs int64  `json:"snapshotAgeMs,omitempty"`
}

type ProjectIndexingStatus struct {
	Status   string                      `json:"status"`
	AST      IndexIndexingPhaseStatus    `json:"ast"`
	Semantic IndexIndexingSemanticStatus `json:"semantic"`
	Cache    *IndexIndexingCacheStatus   `json:"cache,omitempty"`
	Error    string                      `json:"error,omitempty"`
}

// ProjectIndexWatchStatus is the bounded live-indexing status surface exposed
// by the local runtime. It intentionally contains counts and decisions, not
// patch facts or complete Project Index snapshots.
type ProjectIndexWatchStatus struct {
	State   string                    `json:"state"`
	LastRun *ProjectIndexWatchRunInfo `json:"lastRun,omitempty"`
}

// ProjectIndexWatchRunInfo describes the latest coalesced watch indexing run.
type ProjectIndexWatchRunInfo struct {
	RunID                   uint64             `json:"runId"`
	Status                  string             `json:"status"`
	PlanKind                string             `json:"planKind,omitempty"`
	FallbackUsed            bool               `json:"fallbackUsed"`
	FallbackReason          string             `json:"fallbackReason,omitempty"`
	GraphConfidence         string             `json:"graphConfidence,omitempty"`
	ChangedFileCount        int                `json:"changedFileCount"`
	DeletedFileCount        int                `json:"deletedFileCount"`
	AffectedFileCount       int                `json:"affectedFileCount"`
	AffectedDefinitionCount int                `json:"affectedDefinitionCount"`
	PatchCount              int                `json:"patchCount"`
	DeltaBatchCount         int                `json:"deltaBatchCount,omitempty"`
	CoalescedWhileRunning   bool               `json:"coalescedWhileRunning,omitempty"`
	PendingRunReplacedCount int                `json:"pendingRunReplacedCount,omitempty"`
	PhaseTimingsMs          map[string]float64 `json:"phaseTimingsMs,omitempty"`
	SemanticStatus          string             `json:"semanticStatus"`
	StaleSemanticDropped    bool               `json:"staleSemanticDropped,omitempty"`
}

// SourceLoc points to a definition in user source code.
type SourceLoc struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   *int   `json:"column,omitempty"`
	Function string `json:"function,omitempty"`
}

type SourceRange struct {
	File        string `json:"file"`
	StartLine   int    `json:"startLine"`
	EndLine     *int   `json:"endLine,omitempty"`
	StartColumn *int   `json:"startColumn,omitempty"`
	EndColumn   *int   `json:"endColumn,omitempty"`
}

type SourceSnippet struct {
	Source    string      `json:"source"`
	Language  string      `json:"language,omitempty"`
	Range     SourceRange `json:"range"`
	Truncated bool        `json:"truncated,omitempty"`
}

type ProjectSourceRef struct {
	ID          string         `json:"id"`
	Role        string         `json:"role"`
	Property    string         `json:"property,omitempty"`
	Symbol      string         `json:"symbol,omitempty"`
	Source      SourceLoc      `json:"source"`
	Snippet     *SourceSnippet `json:"snippet,omitempty"`
	Fidelity    string         `json:"fidelity"`
	Description string         `json:"description,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// ProjectIdentity identifies the workspace that produced a Project Index.
type ProjectIdentity struct {
	Root          string                `json:"root"`
	Name          string                `json:"name,omitempty"`
	ConfigFile    string                `json:"configFile,omitempty"`
	Observability *ProjectObservability `json:"observability,omitempty"`
}

// ProjectObservability is the privacy-safe effective observability policy.
type ProjectObservability struct {
	RedactPatternsConfigured bool `json:"redactPatternsConfigured"`
}

type IndexLintConfig struct {
	Profile string                         `json:"profile,omitempty"`
	Rules   map[string]IndexLintRuleConfig `json:"rules,omitempty"`
}

type IndexLintRuleConfig struct {
	Enabled  *bool  `json:"enabled,omitempty"`
	Severity string `json:"severity,omitempty"`
}

// ProjectDefinition is the canonical read-model for inspectable authored Crux definitions.
type ProjectDefinition struct {
	ID            string             `json:"id"`
	Kind          string             `json:"kind"`
	Name          string             `json:"name"`
	Description   string             `json:"description,omitempty"`
	Tags          []string           `json:"tags,omitempty"`
	Path          []string           `json:"path,omitempty"`
	Source        *SourceLoc         `json:"source,omitempty"`
	SourceSnippet *SourceSnippet     `json:"sourceSnippet,omitempty"`
	SourceRefs    []ProjectSourceRef `json:"sourceRefs,omitempty"`
	Fidelity      string             `json:"fidelity"`
	Status        string             `json:"status,omitempty"`
	Fingerprint   string             `json:"fingerprint,omitempty"`
	Metadata      json.RawMessage    `json:"metadata,omitempty"`
}

// ProjectRelation describes graph edges between authored Crux definitions.
type ProjectRelation struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	From     string          `json:"from"`
	To       string          `json:"to"`
	Fidelity string          `json:"fidelity"`
	Source   *SourceLoc      `json:"source,omitempty"`
	Metadata json.RawMessage `json:"metadata,omitempty"`
}

// IndexDiagnostic describes an indexer or index-fidelity issue.
type IndexDiagnostic struct {
	ID                   string          `json:"id"`
	Severity             string          `json:"severity"`
	Code                 string          `json:"code"`
	Message              string          `json:"message"`
	Source               *SourceLoc      `json:"source,omitempty"`
	RelatedDefinitionIDs []string        `json:"relatedDefinitionIds,omitempty"`
	SuggestedFix         string          `json:"suggestedFix,omitempty"`
	Evidence             json.RawMessage `json:"evidence,omitempty"`
}

// IndexLintFinding describes an actionable authored-graph issue.
type IndexLintFinding struct {
	ID                      string                     `json:"id"`
	Severity                string                     `json:"severity"`
	RuleID                  string                     `json:"ruleId"`
	Category                string                     `json:"category"`
	Maturity                string                     `json:"maturity"`
	Confidence              string                     `json:"confidence"`
	Profiles                []string                   `json:"profiles"`
	Title                   string                     `json:"title"`
	Message                 string                     `json:"message"`
	Rationale               string                     `json:"rationale"`
	Impact                  string                     `json:"impact,omitempty"`
	Source                  *SourceLoc                 `json:"source,omitempty"`
	PrimaryDefinitionID     string                     `json:"primaryDefinitionId,omitempty"`
	RelatedDefinitionIDs    []string                   `json:"relatedDefinitionIds,omitempty"`
	AffectedDefinitionIDs   []string                   `json:"affectedDefinitionIds,omitempty"`
	Evidence                []IndexLintEvidence        `json:"evidence"`
	Fixes                   []IndexLintFix             `json:"fixes"`
	DocsURL                 string                     `json:"docsUrl,omitempty"`
	Suppression             *IndexLintSuppression      `json:"suppression,omitempty"`
	Suppressed              bool                       `json:"suppressed,omitempty"`
	SuppressedBy            *IndexLintSuppressedBy     `json:"suppressedBy,omitempty"`
	PropagatedDefinitionIDs []string                   `json:"propagatedDefinitionIds,omitempty"`
	PropagationPaths        []IndexLintPropagationPath `json:"propagationPaths,omitempty"`
}

type IndexLintEvidence struct {
	Kind         string          `json:"kind"`
	Label        string          `json:"label"`
	Description  string          `json:"description,omitempty"`
	DefinitionID string          `json:"definitionId,omitempty"`
	RelationID   string          `json:"relationId,omitempty"`
	Source       *SourceLoc      `json:"source,omitempty"`
	Data         json.RawMessage `json:"data,omitempty"`
}

type IndexLintFix struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Kind        string `json:"kind"`
	DocsURL     string `json:"docsUrl,omitempty"`
	Command     string `json:"command,omitempty"`
	Suppression string `json:"suppression,omitempty"`
}

type IndexLintSuppression struct {
	Supported bool   `json:"supported"`
	Directive string `json:"directive"`
	Scope     string `json:"scope"`
}

type IndexLintSuppressedBy struct {
	Source *SourceLoc `json:"source,omitempty"`
	Scope  string     `json:"scope"`
	Reason string     `json:"reason,omitempty"`
}

type IndexLintPropagationPath struct {
	FromDefinitionID string   `json:"fromDefinitionId"`
	ToDefinitionID   string   `json:"toDefinitionId"`
	RelationTypes    []string `json:"relationTypes"`
}

// IndexRuleDescriptor describes available lint rule metadata, including rules
// that did not fire concrete findings in the current Project Index.
type IndexRuleDescriptor struct {
	ID             string                        `json:"id"`
	Source         string                        `json:"source"`
	Extension      *IndexRuleDescriptorExtension `json:"extension,omitempty"`
	Severity       string                        `json:"severity,omitempty"`
	Category       string                        `json:"category,omitempty"`
	Maturity       string                        `json:"maturity,omitempty"`
	Confidence     string                        `json:"confidence,omitempty"`
	Profiles       []string                      `json:"profiles,omitempty"`
	Title          string                        `json:"title"`
	Description    string                        `json:"description"`
	Rationale      string                        `json:"rationale,omitempty"`
	Impact         string                        `json:"impact,omitempty"`
	DocsURL        string                        `json:"docsUrl,omitempty"`
	Fixes          []IndexLintFix                `json:"fixes,omitempty"`
	Suppression    *IndexRuleSuppression         `json:"suppression,omitempty"`
	Requires       []string                      `json:"requires,omitempty"`
	OptionSchema   json.RawMessage               `json:"optionSchema,omitempty"`
	MessageIDs     []string                      `json:"messageIds,omitempty"`
	DefaultOptions json.RawMessage               `json:"defaultOptions,omitempty"`
}

type IndexRuleDescriptorExtension struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
}

type IndexRuleSuppression struct {
	Supported bool   `json:"supported"`
	Scope     string `json:"scope"`
	Directive string `json:"directive,omitempty"`
}

// IndexSourceFile records source files that contributed to the index.
type IndexSourceFile struct {
	File          string   `json:"file"`
	Status        string   `json:"status"`
	SourceHash    string   `json:"sourceHash,omitempty"`
	InterfaceHash string   `json:"interfaceHash,omitempty"`
	DefinitionIDs []string `json:"definitionIds,omitempty"`
	Dependencies  []string `json:"dependencies,omitempty"`
	Dependents    []string `json:"dependents,omitempty"`
	Diagnostics   []string `json:"diagnostics,omitempty"`
}

// PromptMeta describes a registered prompt in the index.
type PromptMeta struct {
	ID               string          `json:"id"`
	Description      *string         `json:"description,omitempty"`
	Tags             []string        `json:"tags,omitempty"`
	Path             []string        `json:"path,omitempty"`
	ContextIDs       []string        `json:"contextIds,omitempty"`
	InputSchema      json.RawMessage `json:"inputSchema,omitempty"`
	OutputSchema     json.RawMessage `json:"outputSchema,omitempty"`
	HasOutput        bool            `json:"hasOutput"`
	Settings         json.RawMessage `json:"settings,omitempty"`
	SystemTemplate   *string         `json:"systemTemplate,omitempty"`
	PromptTemplate   *string         `json:"promptTemplate,omitempty"`
	HasMessages      bool            `json:"hasMessages,omitempty"`
	DefinitionSource *SourceLoc      `json:"definitionSource,omitempty"`
}

// ContextMeta describes a registered context provider in the index.
type ContextMeta struct {
	ID               string          `json:"id"`
	Description      *string         `json:"description,omitempty"`
	Priority         int             `json:"priority"`
	InputSchema      json.RawMessage `json:"inputSchema,omitempty"`
	IsStatic         bool            `json:"isStatic"`
	SystemTemplate   *string         `json:"systemTemplate,omitempty"`
	Path             []string        `json:"path,omitempty"`
	UsedBy           []string        `json:"usedBy,omitempty"`
	DefinitionSource *SourceLoc      `json:"definitionSource,omitempty"`
}

// ToolMeta describes a registered tool in the index.
type ToolMeta struct {
	ID          string          `json:"id"`
	Name        string          `json:"name,omitempty"`
	Description *string         `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema,omitempty"`
	Path        []string        `json:"path,omitempty"`
}

// PromptUsageStat tracks usage statistics for a single prompt ID.
type PromptUsageStat struct {
	Count         int     `json:"count"`
	LastUsed      int64   `json:"lastUsed"`
	ErrorCount    int     `json:"errorCount"`
	AvgDurationMs float64 `json:"avgDurationMs"`
	TotalCost     float64 `json:"totalCost"`
}

// RuntimeFlowRun represents an active or completed flow execution.
type RuntimeFlowRun struct {
	FlowID    string `json:"flowId"`
	Name      string `json:"name"`
	SessionID string `json:"sessionId"`
	Status    string `json:"status"`
	StartedAt int64  `json:"startedAt"`
}

// ConstraintStats holds constraint event counts for the TUI dashboard.
// GuardrailStats holds guardrail event counts for the TUI dashboard.
type GuardrailStats struct {
	Total  int `json:"total"`
	Blocks int `json:"blocks"`
}

type ConstraintStats struct {
	Checks     int `json:"checks"`
	Retries    int `json:"retries"`
	Violations int `json:"violations"`
}
