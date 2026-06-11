package indexread

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func Dir(path string) string {
	if path != "" {
		return path
	}
	return filepath.Join(".crux", "quality")
}

func readQualityRecords(dir string, kind string) ([]json.RawMessage, error) {
	recordsDir := filepath.Join(dir, kind)
	entries, err := os.ReadDir(recordsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []json.RawMessage{}, nil
		}
		return nil, err
	}

	records := make([]json.RawMessage, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(recordsDir, entry.Name()))
		if err != nil {
			return nil, err
		}
		var raw json.RawMessage
		if err := json.Unmarshal(content, &raw); err != nil {
			return nil, err
		}
		records = append(records, raw)
	}
	return records, nil
}

func readQualityRecord(dir string, kind string, id string) (json.RawMessage, error) {
	content, err := os.ReadFile(filepath.Join(dir, kind, safeQualityFileName(id)+".json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("quality %s record %q not found", kind, id)
		}
		return nil, err
	}
	var raw json.RawMessage
	if err := json.Unmarshal(content, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

func writeQualityRecord(dir string, kind string, id string, record any) error {
	recordsDir := filepath.Join(dir, kind)
	if err := os.MkdirAll(recordsDir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(recordsDir, safeQualityFileName(id)+".json"), append(data, '\n'), 0644)
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

type qualitySuiteRecord struct {
	Tag              string             `json:"_tag"`
	SuiteID          string             `json:"suiteId"`
	ID               string             `json:"id,omitempty"`
	Name             string             `json:"name,omitempty"`
	Version          string             `json:"version,omitempty"`
	Source           string             `json:"source,omitempty"`
	Path             string             `json:"path,omitempty"`
	CaseCount        int                `json:"caseCount"`
	Tags             []string           `json:"tags,omitempty"`
	Scorers          []string           `json:"scorers,omitempty"`
	LastExperimentID string             `json:"lastExperimentId,omitempty"`
	LastRunAt        string             `json:"lastRunAt,omitempty"`
	LastPassRate     *float64           `json:"lastPassRate,omitempty"`
	State            string             `json:"state"`
	Cases            []qualitySuiteCase `json:"cases"`
}

type qualitySuiteCase struct {
	CaseID              string                  `json:"caseId"`
	ID                  string                  `json:"id,omitempty"`
	Name                string                  `json:"name,omitempty"`
	Input               any                     `json:"input,omitempty"`
	Expected            any                     `json:"expected,omitempty"`
	Tags                []string                `json:"tags,omitempty"`
	Metadata            map[string]any          `json:"metadata,omitempty"`
	Origin              any                     `json:"origin,omitempty"`
	LastRunStatus       string                  `json:"lastRunStatus,omitempty"`
	LastRunExperimentID string                  `json:"lastRunExperimentId,omitempty"`
	LastRunAt           string                  `json:"lastRunAt,omitempty"`
	Assertions          []qualitySuiteAssertion `json:"assertions,omitempty"`
	FeedbackRating      string                  `json:"feedbackRating,omitempty"`
}

type qualitySuiteAssertion struct {
	Op       string `json:"op"`
	Arg      string `json:"arg"`
	LastPass *bool  `json:"lastPass,omitempty"`
}

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

type qualityInsightStatusRecord struct {
	Tag                 string  `json:"_tag"`
	InsightID           string  `json:"insightId"`
	Status              string  `json:"status"`
	Note                *string `json:"note,omitempty"`
	UpdatedAt           string  `json:"updatedAt"`
	ResolvedAt          string  `json:"resolvedAt,omitempty"`
	ResolvedOccurrences int     `json:"resolvedOccurrences,omitempty"`
}

type qualityInsightSilencePattern struct {
	Title    string `json:"title"`
	TargetID string `json:"targetId,omitempty"`
}

type qualityInsightSilenceRequest struct {
	InsightID *string                       `json:"insightId,omitempty"`
	Pattern   *qualityInsightSilencePattern `json:"pattern,omitempty"`
	Note      *string                       `json:"note,omitempty"`
}

type qualityInsightSilenceRecord struct {
	Tag       string                       `json:"_tag"`
	ID        string                       `json:"id"`
	Pattern   qualityInsightSilencePattern `json:"pattern"`
	Note      *string                      `json:"note,omitempty"`
	CreatedAt string                       `json:"createdAt"`
	DeletedAt string                       `json:"deletedAt,omitempty"`
}

type qualityExperimentRecord struct {
	Tag       string                 `json:"_tag"`
	ID        string                 `json:"id"`
	QualityID string                 `json:"qualityId"`
	Suite     qualityExperimentSuite `json:"suite"`
	StartedAt string                 `json:"startedAt"`
	EndedAt   string                 `json:"endedAt"`
	Status    string                 `json:"status"`
	Summary   struct {
		Total   int `json:"total"`
		Passed  int `json:"passed"`
		Failed  int `json:"failed"`
		Errored int `json:"errored"`
	} `json:"summary"`
	Variants       []qualityExperimentVariant          `json:"variants"`
	VariantConfigs map[string]qualityVariantConfigDiff `json:"variantConfigs,omitempty"`
	Progress       *qualityExperimentProgress          `json:"progress,omitempty"`
	PrimaryScore   string                              `json:"primaryScore,omitempty"`
	Cases          []qualityExperimentCase             `json:"cases"`
}

type qualityExperimentVariant struct {
	ID                    string   `json:"id"`
	TargetID              string   `json:"targetId"`
	DefinitionFingerprint string   `json:"definitionFingerprint,omitempty"`
	Label                 string   `json:"label,omitempty"`
	PassRate              *float64 `json:"passRate,omitempty"`
	MeanScore             *float64 `json:"meanScore,omitempty"`
	TokensAvg             *float64 `json:"tokensAvg,omitempty"`
	LatencyP95Ms          *float64 `json:"latencyP95Ms,omitempty"`
	CostTotal             *float64 `json:"costTotal,omitempty"`
	IsBaseline            bool     `json:"isBaseline,omitempty"`
	IsWinner              bool     `json:"isWinner,omitempty"`
	BaselineDeltaPassPts  *float64 `json:"baselineDeltaPassPts,omitempty"`
}

type qualityVariantConfigDiff struct {
	VsBaselineVariantID string                  `json:"vsBaselineVariantId"`
	Lines               []qualityConfigDiffLine `json:"lines"`
}

type qualityConfigDiffLine struct {
	Op   string `json:"op"`
	Text string `json:"text"`
	Note string `json:"note,omitempty"`
}

type qualityExperimentProgress struct {
	CasesDone      int      `json:"casesDone"`
	CasesTotal     int      `json:"casesTotal"`
	VariantsTotal  int      `json:"variantsTotal"`
	ProviderCalls  int      `json:"providerCalls"`
	EstRemainingMs *int64   `json:"estRemainingMs,omitempty"`
	Seed           *int64   `json:"seed,omitempty"`
	Temperature    *float64 `json:"temperature,omitempty"`
}

type qualityExperimentSuite struct {
	ID        string             `json:"id"`
	Name      string             `json:"name,omitempty"`
	Source    any                `json:"source,omitempty"`
	Path      string             `json:"path,omitempty"`
	CaseCount int                `json:"caseCount"`
	Tags      []string           `json:"tags,omitempty"`
	Snapshot  []qualitySuiteCase `json:"snapshot,omitempty"`
}

type qualityExperimentCase struct {
	CaseID     string         `json:"caseId"`
	CaseName   string         `json:"caseName,omitempty"`
	VariantID  string         `json:"variantId"`
	Status     string         `json:"status"`
	DurationMs float64        `json:"durationMs"`
	Scores     []qualityScore `json:"scores"`
	TraceID    string         `json:"traceId,omitempty"`
	Input      any            `json:"input,omitempty"`
	Output     any            `json:"output,omitempty"`
	Error      any            `json:"error,omitempty"`
}

type qualityScore struct {
	Kind  string   `json:"kind"`
	Name  string   `json:"name"`
	Value *float64 `json:"value,omitempty"`
}

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

type qualityComparisonRecord struct {
	Tag        string                       `json:"_tag"`
	ID         string                       `json:"id"`
	QualityID  string                       `json:"qualityId"`
	ComparedAt string                       `json:"comparedAt"`
	Baseline   qualityComparisonSummary     `json:"baseline"`
	Candidate  qualityComparisonSummary     `json:"candidate"`
	Metrics    qualityComparisonMetrics     `json:"metrics"`
	CaseDeltas []qualityComparisonCaseDelta `json:"caseDeltas,omitempty"`
	Status     string                       `json:"status"`
}

type qualityComparisonCaseDelta struct {
	CaseID       string                     `json:"caseId"`
	CaseName     string                     `json:"caseName,omitempty"`
	Status       string                     `json:"status"`
	Baseline     *qualityComparisonCaseSide `json:"baseline,omitempty"`
	Candidate    *qualityComparisonCaseSide `json:"candidate,omitempty"`
	ScoreDelta   *float64                   `json:"scoreDelta,omitempty"`
	OutputChange string                     `json:"outputChange,omitempty"`
}

type qualityComparisonCaseSide struct {
	TraceID       string   `json:"traceId,omitempty"`
	Status        string   `json:"status"`
	OutputPreview string   `json:"outputPreview,omitempty"`
	Score         *float64 `json:"score,omitempty"`
	DurationMs    float64  `json:"durationMs"`
}

type qualityComparisonSummary struct {
	ExperimentID  string             `json:"experimentId"`
	VariantID     *string            `json:"variantId,omitempty"`
	Label         *string            `json:"label,omitempty"`
	Total         int                `json:"total"`
	Passed        int                `json:"passed"`
	Failed        int                `json:"failed"`
	Errored       int                `json:"errored"`
	PassRate      float64            `json:"passRate"`
	AvgDurationMs float64            `json:"avgDurationMs"`
	NumericScores map[string]float64 `json:"numericScores"`
}

type qualityComparisonMetrics struct {
	PassRateDelta      float64                             `json:"passRateDelta"`
	AvgDurationMsDelta float64                             `json:"avgDurationMsDelta"`
	NumericScoreDeltas map[string]qualityNumericScoreDelta `json:"numericScoreDeltas"`
}

type qualityNumericScoreDelta struct {
	Baseline  *float64 `json:"baseline,omitempty"`
	Candidate *float64 `json:"candidate,omitempty"`
	Delta     *float64 `json:"delta,omitempty"`
}

type qualityBaselinePostRequest struct {
	ID         string  `json:"id"`
	Experiment string  `json:"experiment"`
	VariantID  *string `json:"variantId,omitempty"`
	Label      *string `json:"label,omitempty"`
}

type qualityBaselineRecord struct {
	Tag          string                   `json:"_tag"`
	ID           string                   `json:"id"`
	QualityID    string                   `json:"qualityId"`
	ExperimentID string                   `json:"experimentId"`
	VariantID    *string                  `json:"variantId,omitempty"`
	Label        *string                  `json:"label,omitempty"`
	PromotedAt   string                   `json:"promotedAt"`
	Summary      qualityComparisonSummary `json:"summary"`
}

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
