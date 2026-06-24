package quality

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func Dir(path string) string {
	return qualityfs.Dir(path)
}

type qualityOverviewRecord struct {
	Tag                         string              `json:"_tag"`
	RunCount                    int                 `json:"runCount"`
	SuiteCount                  int                 `json:"suiteCount"`
	ExperimentCount             int                 `json:"experimentCount"`
	ComparisonCount             int                 `json:"comparisonCount"`
	BaselineCount               int                 `json:"baselineCount"`
	FeedbackCount               int                 `json:"feedbackCount"`
	FeedbackNeedingReviewCount  int                 `json:"feedbackNeedingReviewCount"`
	CassetteCount               int                 `json:"cassetteCount"`
	CassetteIssueCount          int                 `json:"cassetteIssueCount"`
	InsightCount                int                 `json:"insightCount"`
	LatestExperimentID          string              `json:"latestExperimentId,omitempty"`
	LatestExperimentPassRate    *float64            `json:"latestExperimentPassRate,omitempty"`
	LatestExperimentCompletedAt string              `json:"latestExperimentCompletedAt,omitempty"`
	PassRate                    *float64            `json:"passRate,omitempty"`
	MeanScore                   *float64            `json:"meanScore,omitempty"`
	TotalCost                   float64             `json:"totalCost"`
	P50LatencyMs                *float64            `json:"p50LatencyMs,omitempty"`
	P95LatencyMs                *float64            `json:"p95LatencyMs,omitempty"`
	CostPer100Runs              *float64            `json:"costPer100Runs,omitempty"`
	PassRateHistory             []float64           `json:"passRateHistory"`
	OpenInsightsHistory         []int               `json:"openInsightsHistory"`
	PassRateSpark               []float64           `json:"passRateSpark"`
	CostSpark                   []float64           `json:"costSpark"`
	LatencySpark                []float64           `json:"latencySpark"`
	OpenInsightSeverityCounts   map[string]int      `json:"openInsightSeverityCounts,omitempty"`
	RunTabCounts                qualityRunTabCounts `json:"runTabCounts"`
	RecentRuns                  []qualityRunRecord  `json:"recentRuns,omitempty"`
}

type qualityRunTabCounts struct {
	All         int `json:"all"`
	Live        int `json:"live"`
	Failures    int `json:"failures"`
	HasFeedback int `json:"hasFeedback"`
}

// qualityRunRecord represents one top-level execution. When the underlying
// trace is a flow / pipeline that fanned out into multiple child traces,
// all of them are folded into this one record (metrics aggregated, span
// detail stitched together). TraceCount reports how many traces are in
// the family (1 for a standalone trace).
type qualityRunRecord struct {
	Tag            string         `json:"_tag"`
	TraceID        string         `json:"traceId"`
	TargetID       string         `json:"targetId,omitempty"`
	PromptID       *string        `json:"promptId,omitempty"`
	FlowID         string         `json:"flowId,omitempty"`
	ParentRunID    string         `json:"parentRunId,omitempty"`
	RootPrimitive  string         `json:"rootPrimitive,omitempty"`
	Kind           string         `json:"kind,omitempty"`
	Status         string         `json:"status"`
	StartedAt      int64          `json:"startedAt"`
	DurationMs     *float64       `json:"durationMs,omitempty"`
	Model          string         `json:"model,omitempty"`
	Provider       string         `json:"provider,omitempty"`
	Input          map[string]any `json:"input,omitempty"`
	Output         any            `json:"output,omitempty"`
	Error          any            `json:"error,omitempty"`
	Usage          any            `json:"usage,omitempty"`
	Cost           *float64       `json:"cost,omitempty"`
	TokenCount     int            `json:"tokenCount,omitempty"`
	Score          *float64       `json:"score,omitempty"`
	ScoreName      string         `json:"scoreName,omitempty"`
	ToolCallCount  int            `json:"toolCallCount"`
	SpanCount      int            `json:"spanCount,omitempty"`
	ChildCount     int            `json:"childCount,omitempty"`
	TraceCount     int            `json:"traceCount,omitempty"`
	SessionID      string         `json:"sessionId,omitempty"`
	FeedbackCount  int            `json:"feedbackCount,omitempty"`
	FeedbackIDs    []string       `json:"feedbackIds"`
	ExperimentIDs  []string       `json:"experimentIds"`
	CassetteStatus string         `json:"cassetteStatus,omitempty"`
	CassettePaths  []string       `json:"cassettePaths,omitempty"`

	DiagnosticCount         int      `json:"diagnosticsCount,omitempty"`
	DiagnosticMaxSeverity   string   `json:"diagnosticsMaxSeverity,omitempty"`
	DiagnosticCodes         []string `json:"diagnosticCodes,omitempty"`
	ToolErrorCount          int      `json:"-"`
	RepeatedToolName        string   `json:"-"`
	RepeatedToolCount       int      `json:"-"`
	RetrievalIssueCount     int      `json:"-"`
	QualitySignalIssueCount int      `json:"-"`
	SuspensionSignalCount   int      `json:"-"`
	BlockedSignalCount      int      `json:"-"`
}

type qualityRunDetailRecord struct {
	Tag       string                     `json:"_tag"`
	Run       qualityRunRecord           `json:"run"`
	Trace     qualityTraceRecord         `json:"trace"`
	Events    []store.CorrelatedEvent    `json:"events"`
	Spans     []qualityRunSpan           `json:"spans"`
	Narrative []qualityRunNarrativeEvent `json:"narrative"`
}

type qualityTraceRecord struct {
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

// qualityRunSpan mirrors api.QualityRunSpan; see that type for field
// semantics. Primitive is the closed-enum classification of the
// @crux/core primitive this span represents; CompositionType is only set
// when Primitive == "composition" (pipeline | parallel | consensus | swarm).
type qualityRunSpan struct {
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
	Timings           *qualitySpanTimingsRecord `json:"timings,omitempty"`
	LinkedInsightIDs  []string                  `json:"linkedInsightIds,omitempty"`
}

type qualitySpanTimingsRecord struct {
	TTFTMs          *float64 `json:"ttftMs,omitempty"`
	ChunksReceived  int      `json:"chunksReceived,omitempty"`
	TotalChunks     *int     `json:"totalChunks,omitempty"`
	TokensPerSecond *float64 `json:"tokensPerSecond,omitempty"`
	Retries         int      `json:"retries,omitempty"`
	SelfMs          *float64 `json:"selfMs,omitempty"`
}

type qualityRunNarrativeEvent struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	Label     string         `json:"label"`
	Timestamp int64          `json:"timestamp"`
	OffsetMs  int64          `json:"offsetMs"`
	Data      map[string]any `json:"data,omitempty"`
}

type qualitySuiteRecord = qualityfs.Suite
type qualitySuiteCase = qualityfs.SuiteCase
type qualitySuiteAssertion = qualityfs.SuiteAssertion

type qualityInsightRecord struct {
	Tag                  string                     `json:"_tag"`
	InsightID            string                     `json:"insightId"`
	Title                string                     `json:"title"`
	Severity             string                     `json:"severity"`
	Tags                 []string                   `json:"tags"`
	Summary              string                     `json:"summary"`
	TargetID             string                     `json:"targetId,omitempty"`
	LinkedTraceIDs       []string                   `json:"linkedTraceIds,omitempty"`
	LinkedExperimentIDs  []string                   `json:"linkedExperimentIds,omitempty"`
	LinkedCaseIDs        []string                   `json:"linkedCaseIds,omitempty"`
	LinkedCassettePaths  []string                   `json:"linkedCassettePaths,omitempty"`
	LinkedDefinitionIDs  []string                   `json:"linkedDefinitionIds,omitempty"`
	LinkedSources        []store.SourceLoc          `json:"linkedSources,omitempty"`
	SuspectedCause       string                     `json:"suspectedCause,omitempty"`
	ProposedFix          string                     `json:"proposedFix,omitempty"`
	OccurrenceCount      int                        `json:"occurrenceCount"`
	Trend                []float64                  `json:"trend"`
	ProposedFixConfig    *qualityInsightFixConfig   `json:"proposedFixConfig,omitempty"`
	DetailStats          *qualityInsightDetailStats `json:"detailStats,omitempty"`
	Status               string                     `json:"status"`
	UpdatedAt            string                     `json:"updatedAt,omitempty"`
	ResolvedAt           string                     `json:"resolvedAt,omitempty"`
	ResolvedOccurrences  int                        `json:"resolvedOccurrences,omitempty"`
	ReopenedAt           string                     `json:"reopenedAt,omitempty"`
	PreviousResolutionAt string                     `json:"previousResolutionAt,omitempty"`
}

type qualityInsightFixConfig struct {
	YAML       string   `json:"yaml,omitempty"`
	ConfigKeys []string `json:"configKeys,omitempty"`
}

type qualityInsightDetailStats struct {
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

type qualityInsightStatusRequest struct {
	Status string  `json:"status"`
	Note   *string `json:"note,omitempty"`
}

type qualityInsightStatusRecord = qualityfs.InsightStatus
type qualityInsightSilencePattern = qualityfs.InsightSilencePattern

type qualityInsightSilenceRequest struct {
	InsightID *string                       `json:"insightId,omitempty"`
	Pattern   *qualityInsightSilencePattern `json:"pattern,omitempty"`
	Note      *string                       `json:"note,omitempty"`
}

type qualityInsightSilenceRecord = qualityfs.InsightSilence

type qualityFeedbackPostRequest struct {
	TraceID      *string                `json:"traceId,omitempty"`
	ExperimentID *string                `json:"experimentId,omitempty"`
	CaseID       *string                `json:"caseId,omitempty"`
	Rating       *int                   `json:"rating,omitempty"`
	Comment      *string                `json:"comment,omitempty"`
	Expected     map[string]interface{} `json:"expected,omitempty"`
	Tags         []string               `json:"tags,omitempty"`
	Metadata     map[string]interface{} `json:"metadata,omitempty"`
}

type qualityFeedbackAnnotationPostRequest struct {
	FeedbackID string                 `json:"feedbackId"`
	Status     string                 `json:"status,omitempty"`
	Note       *string                `json:"note,omitempty"`
	Expected   map[string]interface{} `json:"expected,omitempty"`
	Tags       []string               `json:"tags,omitempty"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
}

type qualityExperimentRecord = qualityfs.Experiment
type qualityExperimentSummary = qualityfs.ExperimentSummary
type qualityExperimentVariant = qualityfs.ExperimentVariant
type qualityVariantConfigDiff = qualityfs.VariantConfigDiff
type qualityConfigDiffLine = qualityfs.ConfigDiffLine
type qualityExperimentProgress = qualityfs.ExperimentProgress
type qualityExperimentSuite = qualityfs.ExperimentSuite
type qualityExperimentCase = qualityfs.ExperimentCase
type qualityScore = qualityfs.Score

type qualityComparisonPostRequest struct {
	ID        string                       `json:"id,omitempty"`
	Baseline  qualityComparisonSideRequest `json:"baseline"`
	Candidate qualityComparisonSideRequest `json:"candidate"`
}

type qualityComparisonSideRequest struct {
	Experiment string  `json:"experiment"`
	VariantID  *string `json:"variantId,omitempty"`
	Label      *string `json:"label,omitempty"`
}

type qualityComparisonRecord = qualityfs.Comparison
type qualityComparisonCaseDelta = qualityfs.ComparisonCaseDelta
type qualityComparisonCaseSide = qualityfs.ComparisonCaseSide
type qualityComparisonSummary = qualityfs.ComparisonSummary
type qualityComparisonMetrics = qualityfs.ComparisonMetrics
type qualityNumericScoreDelta = qualityfs.NumericScoreDelta

type qualityBaselinePostRequest struct {
	ID         string  `json:"id"`
	Experiment string  `json:"experiment"`
	VariantID  *string `json:"variantId,omitempty"`
	Label      *string `json:"label,omitempty"`
}

type qualityBaselineRecord = qualityfs.Baseline

type qualityScorerRecord struct {
	Tag        string   `json:"_tag"`
	Name       string   `json:"name"`
	Kind       string   `json:"kind"`
	SuiteIDs   []string `json:"suiteIds,omitempty"`
	RunCount   int      `json:"runCount"`
	PassRate   *float64 `json:"passRate,omitempty"`
	MeanScore  *float64 `json:"meanScore,omitempty"`
	LastUsedAt string   `json:"lastUsedAt,omitempty"`
}
