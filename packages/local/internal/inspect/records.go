package inspect

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/inspectfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func Dir(path string) string {
	return inspectfs.Dir(path)
}

type inspectRunTabCounts struct {
	All      int `json:"all"`
	Live     int `json:"live"`
	Failures int `json:"failures"`
}

// inspectRunRecord represents one operation. Independently durable child runs
// are folded into this record while TraceID remains the exact W3C trace.
type inspectRunRecord struct {
	Tag           string         `json:"_tag"`
	OperationID   string         `json:"operationId"`
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
	TraceCount    int            `json:"traceCount,omitempty"`
	SessionID     string         `json:"sessionId,omitempty"`

	DiagnosticCount         int      `json:"diagnosticsCount,omitempty"`
	DiagnosticMaxSeverity   string   `json:"diagnosticsMaxSeverity,omitempty"`
	DiagnosticCodes         []string `json:"diagnosticCodes,omitempty"`
	ToolErrorCount          int      `json:"-"`
	RepeatedToolName        string   `json:"-"`
	RepeatedToolCount       int      `json:"-"`
	RetrievalIssueCount     int      `json:"-"`
	InspectSignalIssueCount int      `json:"-"`
	SuspensionSignalCount   int      `json:"-"`
	BlockedSignalCount      int      `json:"-"`
}

func inspectRunIdentity(run inspectRunRecord) string {
	if run.OperationID != "" {
		return run.OperationID
	}
	return run.TraceID
}

type inspectRunDetailRecord struct {
	Tag       string                     `json:"_tag"`
	Run       inspectRunRecord           `json:"run"`
	Trace     inspectTraceRecord         `json:"trace"`
	Events    []store.CorrelatedEvent    `json:"events"`
	Spans     []inspectRunSpan           `json:"spans"`
	Narrative []inspectRunNarrativeEvent `json:"narrative"`
}

type inspectTraceRecord struct {
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

// inspectRunSpan mirrors api.InspectRunSpan; see that type for field
// semantics. Primitive is the closed-enum classification of the
// @use-crux/core primitive this span represents; CompositionType is only set
// when Primitive == "composition" (pipeline | parallel | consensus | swarm).
type inspectRunSpan struct {
	ID                string                    `json:"id"`
	ParentID          string                    `json:"parentId,omitempty"`
	Kind              string                    `json:"kind"`
	Op                string                    `json:"op"`
	Primitive         string                    `json:"primitive"`
	CompositionType   string                    `json:"compositionType,omitempty"`
	Name              string                    `json:"name"`
	Status            string                    `json:"status"`
	StartedAt         int64                     `json:"startedAt,omitempty"`
	EndedAt           int64                     `json:"endedAt,omitempty"`
	DurationMs        *float64                  `json:"durationMs,omitempty"`
	TokenCount        int                       `json:"tokenCount,omitempty"`
	Cost              *float64                  `json:"cost,omitempty"`
	EventType         string                    `json:"eventType,omitempty"`
	Duplicate         bool                      `json:"duplicate"`
	DuplicateOfSpanID string                    `json:"duplicateOfSpanId,omitempty"`
	Attributes        map[string]string         `json:"attributes,omitempty"`
	Data              json.RawMessage           `json:"data,omitempty"`
	Timings           *inspectSpanTimingsRecord `json:"timings,omitempty"`
	LinkedInsightIDs  []string                  `json:"linkedInsightIds,omitempty"`
}

type inspectSpanTimingsRecord struct {
	TTFTMs          *float64 `json:"ttftMs,omitempty"`
	ChunksReceived  int      `json:"chunksReceived,omitempty"`
	TotalChunks     *int     `json:"totalChunks,omitempty"`
	TokensPerSecond *float64 `json:"tokensPerSecond,omitempty"`
	Retries         int      `json:"retries,omitempty"`
	SelfMs          *float64 `json:"selfMs,omitempty"`
}

type inspectRunNarrativeEvent struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	Label     string         `json:"label"`
	Timestamp int64          `json:"timestamp"`
	OffsetMs  int64          `json:"offsetMs"`
	Data      map[string]any `json:"data,omitempty"`
}

type inspectInsightRecord struct {
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
	LinkedSources        []store.SourceLoc          `json:"linkedSources,omitempty"`
	SuspectedCause       string                     `json:"suspectedCause,omitempty"`
	ProposedFix          string                     `json:"proposedFix,omitempty"`
	OccurrenceCount      int                        `json:"occurrenceCount"`
	Trend                []float64                  `json:"trend"`
	ProposedFixConfig    *inspectInsightFixConfig   `json:"proposedFixConfig,omitempty"`
	DetailStats          *inspectInsightDetailStats `json:"detailStats,omitempty"`
	Status               string                     `json:"status"`
	UpdatedAt            string                     `json:"updatedAt,omitempty"`
	ResolvedAt           string                     `json:"resolvedAt,omitempty"`
	ResolvedOccurrences  int                        `json:"resolvedOccurrences,omitempty"`
	ReopenedAt           string                     `json:"reopenedAt,omitempty"`
	PreviousResolutionAt string                     `json:"previousResolutionAt,omitempty"`
}

type inspectInsightFixConfig struct {
	YAML       string   `json:"yaml,omitempty"`
	ConfigKeys []string `json:"configKeys,omitempty"`
}

type inspectInsightDetailStats struct {
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

type inspectInsightStatusRequest struct {
	Status string  `json:"status"`
	Note   *string `json:"note,omitempty"`
}

type inspectInsightStatusRecord = inspectfs.InsightStatus
type inspectInsightSilencePattern = inspectfs.InsightSilencePattern

type inspectInsightSilenceRequest struct {
	InsightID *string                       `json:"insightId,omitempty"`
	Pattern   *inspectInsightSilencePattern `json:"pattern,omitempty"`
	Note      *string                       `json:"note,omitempty"`
}

type inspectInsightSilenceRecord = inspectfs.InsightSilence
