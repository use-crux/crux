package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("observability record not found")

const (
	defaultQueryTimeout       = 5 * time.Second
	defaultMutationTimeout    = 10 * time.Second
	defaultMaintenanceTimeout = 15 * time.Second
	inMemoryMaxOpenConns      = 1
	fileDatabaseMaxOpenConns  = 8
	tokenChunkEventName       = "token.chunk"
	tokenChunkRingLimit       = 512
	defaultSpanEventListLimit = 200
	// DefaultRunListLimit is the server-side page size for observability run
	// lists when callers do not request an explicit limit. Run detail and graph
	// reads remain exact; only list endpoints use this protection.
	DefaultRunListLimit = 250
)

type Service struct {
	db            *sql.DB
	events        *EventBus
	queryTO       time.Duration
	mutationTO    time.Duration
	maintenanceTO time.Duration
	mutationMu    sync.Mutex

	retentionSettings  retentionSettings
	lifecycleRunDetail func(context.Context, string) (RunDetail, error)
	// revisionLogRetention bounds the change log; tests shrink it to exercise
	// catch-up expiry deterministically. Zero uses defaultRevisionLogRetention.
	revisionLogRetention int

	tokenMu      sync.Mutex
	tokenPending map[tokenChunkKey]pendingTokenChunk
	tokenTimer   *time.Timer

	unknownRecordTypes atomic.Int64
}

type Event struct {
	Tag       string          `json:"_tag"`
	ID        string          `json:"id"`
	Timestamp int64           `json:"timestamp"`
	Kind      string          `json:"kind"`
	Action    string          `json:"action"`
	Severity  string          `json:"severity"`
	RefID     string          `json:"refId"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type lifecycleReconciliation struct {
	RunID          string
	Status         string
	EndedAt        string
	Reason         string
	Severity       string
	Signature      string
	LastActivityAt string
}

type EventBus struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

func NewEventBus() *EventBus {
	return &EventBus{subs: make(map[chan Event]struct{})}
}

func (b *EventBus) Subscribe(ctx context.Context) <-chan Event {
	ch := make(chan Event, 128)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()

	go func() {
		<-ctx.Done()
		b.mu.Lock()
		delete(b.subs, ch)
		close(ch)
		b.mu.Unlock()
	}()

	return ch
}

func (b *EventBus) Publish(event Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- event:
		default:
		}
	}
}

type RunSummary struct {
	RunID              string              `json:"runId"`
	TraceID            string              `json:"traceId"`
	SessionID          string              `json:"sessionId,omitempty"`
	UserID             string              `json:"userId,omitempty"`
	Deployment         *DeploymentIdentity `json:"deployment,omitempty"`
	Name               string              `json:"name"`
	RootPrimitive      string              `json:"rootPrimitive"`
	Status             string              `json:"status"`
	StartedAt          string              `json:"startedAt"`
	EndedAt            string              `json:"endedAt"`
	DurationMs         float64             `json:"durationMs"`
	Model              string              `json:"model"`
	Provider           string              `json:"provider"`
	PromptID           string              `json:"promptId"`
	RecordCount        int                 `json:"recordCount"`
	SpanCount          int                 `json:"spanCount"`
	EventCount         int                 `json:"eventCount"`
	ArtifactCount      int                 `json:"artifactCount"`
	EdgeCount          int                 `json:"edgeCount"`
	SegmentCount       int                 `json:"segmentCount"`
	ActiveSegmentID    string              `json:"activeSegmentId,omitempty"`
	OrderingConfidence string              `json:"orderingConfidence"`
	GapCount           int                 `json:"gapCount"`
	TraceAliasConflict bool                `json:"traceAliasConflict,omitempty"`
	inputTokens        int                 `json:"-"`
	outputTokens       int                 `json:"-"`
	costUSD            float64             `json:"-"`
	LastActivityAt     string              `json:"lastActivityAt,omitempty"`
	// Revision is the server-owned read-model revision this run last changed
	// at. Zero means the run predates revision tracking (pre-Phase-11 rows
	// before their next write).
	Revision int64 `json:"revision"`
	// DeliveryHealth reports this run's ingest/delivery health. Nil means no
	// health signal has been correlated to the run at all, which callers must
	// render as "unknown" rather than assuming healthy.
	DeliveryHealth *RunDeliveryHealth `json:"deliveryHealth,omitempty"`
	Attributes     json.RawMessage    `json:"attributes,omitempty"`
	Metrics        json.RawMessage    `json:"metrics,omitempty"`
	Error          json.RawMessage    `json:"error,omitempty"`
}

// RunDeliveryHealth reports what is truthfully known about ingest/delivery
// health for one run. "unknown" is a distinct status from "healthy": the
// server never invents correlation between a run and an out-of-band source
// health signal it cannot actually trace back to that run.
type RunDeliveryHealth struct {
	// Status is "unknown" (no persisted correlation to any health signal),
	// "healthy" (correlated signals with no rejects), or "degraded"
	// (correlated signals report retries/rejects/drops).
	Status      string `json:"status"`
	Rejected    int    `json:"rejected,omitempty"`
	LastKnownAt string `json:"lastKnownAt,omitempty"`
}

type RunListOptions struct {
	// Limit caps the newest-first run list. Zero uses DefaultRunListLimit;
	// negative values request the full history for maintenance/CLI callers.
	Limit  int
	Offset int
	// SessionID restricts the run list to runs that were started with this
	// correlator. Empty means no session filter.
	SessionID string
	// Status restricts the run list to these lifecycle statuses. Empty means
	// no status filter. Applied in SQL before Limit/Offset so filters are
	// evaluated over the full history, not just the newest window.
	Status []string
	// Since/Until bound startedAt (RFC3339Nano, inclusive) before Limit/Offset.
	Since string
	Until string
	// DefinitionID restricts the run list to runs whose records referenced this
	// Project Index definition (via DefinitionRef), backed by the derived
	// run_definition_activity projection. Empty means no definition filter. It
	// is a plain indexed equality lookup on the runtime-emitted id — it never
	// consults the current Project Index snapshot, so runs that referenced a
	// since-deleted definition are still returned rather than silently dropped.
	DefinitionID string
	// Cursor requests the page strictly after this opaque, server-issued
	// cursor (see RunsPage/NextCursor) instead of Offset. Cursor pagination is
	// stable across concurrent inserts; Offset is not and remains only for
	// maintenance and internal callers.
	Cursor string
	// IncludeExpensiveRollups asks list reads to scan span/event metric JSON.
	// UI list endpoints leave this off; single-run detail reads remain exact.
	IncludeExpensiveRollups bool
}

// RunsResponse is the one joined, revisioned Runs read model. Revision is the
// server's current revision at read time; NextCursor is set when more rows
// exist beyond Limit.
type RunsResponse struct {
	Revision   int64        `json:"revision"`
	Rows       []RunSummary `json:"rows"`
	NextCursor string       `json:"nextCursor,omitempty"`
}

type SpanEventListOptions struct {
	// Name restricts the result to one event name. Empty returns all lazy span
	// events for the span.
	Name string
	// After restricts the result to events strictly after this event timestamp.
	After string
	// Limit caps the ordered result. Zero uses the lazy endpoint default.
	Limit int
}

type Graph struct {
	Run       RunSummary         `json:"run"`
	Spans     []SpanSummary      `json:"spans"`
	Events    []SpanEventSummary `json:"events"`
	Artifacts []ArtifactSummary  `json:"artifacts"`
	Edges     []EdgeSummary      `json:"edges"`
	Records   []StoredRecord     `json:"records"`
}

type ResourceActivity struct {
	SpanID     string             `json:"spanId"`
	RunID      string             `json:"runId"`
	TraceID    string             `json:"traceId"`
	Family     string             `json:"family"`
	Primitive  string             `json:"primitive"`
	Name       string             `json:"name"`
	Status     string             `json:"status"`
	StartedAt  string             `json:"startedAt"`
	EndedAt    string             `json:"endedAt"`
	DurationMs float64            `json:"durationMs"`
	ResourceID string             `json:"resourceId"`
	Attributes json.RawMessage    `json:"attributes,omitempty"`
	Metrics    json.RawMessage    `json:"metrics,omitempty"`
	Error      json.RawMessage    `json:"error,omitempty"`
	Artifacts  []ResourceArtifact `json:"artifacts,omitempty"`
	Edges      []EdgeSummary      `json:"edges,omitempty"`
}

type ResourceArtifact struct {
	ArtifactID  string          `json:"artifactId"`
	RunID       string          `json:"runId"`
	TraceID     string          `json:"traceId"`
	SpanID      string          `json:"spanId"`
	Kind        string          `json:"kind"`
	CreatedAt   string          `json:"createdAt"`
	ContentType string          `json:"contentType"`
	Encoding    string          `json:"encoding"`
	SizeBytes   int64           `json:"sizeBytes"`
	Hash        string          `json:"hash"`
	Preview     json.RawMessage `json:"preview,omitempty"`
	URI         string          `json:"uri"`
	Attributes  json.RawMessage `json:"attributes,omitempty"`
}

type presentation struct {
	Run             RunSummary             `json:"run"`
	DisplayMode     string                 `json:"displayMode"`
	Spans           []presentationNode     `json:"spans"`
	RunDetails      []presentationDetail   `json:"runDetails,omitempty"`
	HiddenSpanCount int                    `json:"hiddenSpanCount"`
	Counts          presentationViewCounts `json:"counts"`
}

type presentationViewCounts struct {
	Primary  int `json:"primary"`
	Detail   int `json:"detail"`
	Metadata int `json:"metadata"`
}

type presentationNode struct {
	SpanSummary
	Display               string               `json:"display"`
	CanonicalParentSpanID string               `json:"-"`
	OrderAfterSpanID      string               `json:"-"`
	Details               []presentationDetail `json:"details,omitempty"`
	Children              []presentationNode   `json:"children"`
}

type presentationDetail struct {
	SpanSummary
	Display string `json:"display"`
}

type RunDetail struct {
	SchemaVersion  int                           `json:"schemaVersion"`
	Run            RunSummary                    `json:"run"`
	Root           RunDetailNode                 `json:"root"`
	Rows           []RunDetailRow                `json:"rows"`
	SpanIndex      map[string]RunDetailPlacement `json:"spanIndex"`
	Facets         map[string]map[string]int     `json:"facets"`
	Diagnostics    []RunDetailDiagnostic         `json:"diagnostics"`
	Counts         RunDetailCounts               `json:"counts"`
	DefinitionRefs []DefinitionRef               `json:"definitionRefs"`
	Debug          *Graph                        `json:"debug,omitempty"`
}

type RunDetailCounts struct {
	Primary         int `json:"primary"`
	Detail          int `json:"detail"`
	Metadata        int `json:"metadata"`
	AttachedDetails int `json:"attachedDetails"`
}

type RunDetailNode struct {
	SpanSummary
	ID             string                 `json:"id"`
	Virtual        bool                   `json:"virtual"`
	ParentID       string                 `json:"parentId"`
	Path           []string               `json:"path"`
	Kind           string                 `json:"kind"`
	Display        RunDetailDisplay       `json:"display"`
	Timing         RunDetailTiming        `json:"timing"`
	MetricBuckets  RunDetailMetricBuckets `json:"metricBuckets"`
	Source         RunDetailSource        `json:"source"`
	Details        []RunDetailDetail      `json:"details"`
	Artifacts      []ArtifactSummary      `json:"artifacts"`
	Events         []SpanEventSummary     `json:"events"`
	Relations      []EdgeSummary          `json:"relations"`
	Diagnostics    []RunDetailDiagnostic  `json:"diagnostics"`
	Flow           map[string]any         `json:"flow,omitempty"`
	Step           map[string]any         `json:"step,omitempty"`
	Composition    map[string]any         `json:"composition,omitempty"`
	Transition     map[string]any         `json:"transition,omitempty"`
	Request        *RunDetailRequest      `json:"request,omitempty"`
	DecisionReport *TurnDecisionReport    `json:"decisionReport,omitempty"`
	Inspection     RunDetailInspection    `json:"inspection,omitempty"`
	Children       []RunDetailNode        `json:"children"`
}

type RunDetailDetail struct {
	SpanSummary
	ID             string                `json:"id"`
	Kind           string                `json:"kind"`
	Role           string                `json:"role,omitempty"`
	Label          string                `json:"label"`
	Display        string                `json:"display"`
	Timing         RunDetailTiming       `json:"timing"`
	Summary        string                `json:"summary,omitempty"`
	Events         []SpanEventSummary    `json:"events"`
	Artifacts      []ArtifactSummary     `json:"artifacts"`
	Relations      []EdgeSummary         `json:"relations"`
	Diagnostics    []RunDetailDiagnostic `json:"diagnostics"`
	Source         RunDetailSource       `json:"source"`
	Request        *RunDetailRequest     `json:"request,omitempty"`
	DecisionReport *TurnDecisionReport   `json:"decisionReport,omitempty"`
	Inspection     RunDetailInspection   `json:"inspection,omitempty"`
}

type RunDetailRequest struct {
	Mode           string                          `json:"mode"`
	Representative *RunDetailRequestRepresentative `json:"representative,omitempty"`
	ModelSummary   *RunDetailRequestModelSummary   `json:"modelSummary,omitempty"`
	BasePrompt     *RunDetailRequestBasePrompt     `json:"basePrompt,omitempty"`
	Messages       *RunDetailRequestMessages       `json:"messages,omitempty"`
	Contributions  []RunDetailRequestContribution  `json:"contributions"`
	Budget         *RunDetailRequestBudget         `json:"budget,omitempty"`
	Tools          []RunDetailRequestTool          `json:"tools"`
	Turns          []RunDetailRequestTurn          `json:"turns,omitempty"`
	Diagnostics    []string                        `json:"diagnostics,omitempty"`
}

type RunDetailRequestRepresentative struct {
	SpanID   string `json:"spanId"`
	Strategy string `json:"strategy"`
	Reason   string `json:"reason"`
}

type RunDetailRequestModelSummary struct {
	PrimaryModel    string                  `json:"primaryModel,omitempty"`
	PrimaryProvider string                  `json:"primaryProvider,omitempty"`
	Mixed           bool                    `json:"mixed"`
	Models          []RunDetailRequestModel `json:"models"`
}

type RunDetailRequestModel struct {
	Model    string   `json:"model,omitempty"`
	Provider string   `json:"provider,omitempty"`
	SpanIDs  []string `json:"spanIds"`
	Count    int      `json:"count"`
}

type RunDetailRequestBasePrompt struct {
	SourceID      string          `json:"sourceId"`
	Text          string          `json:"text,omitempty"`
	Segments      json.RawMessage `json:"segments,omitempty"`
	Tokens        *float64        `json:"tokens,omitempty"`
	StaticTokens  *float64        `json:"staticTokens,omitempty"`
	DynamicTokens *float64        `json:"dynamicTokens,omitempty"`
}

type RunDetailRequestMessages struct {
	ArtifactID           string          `json:"artifactId,omitempty"`
	Source               string          `json:"source,omitempty"`
	Phase                string          `json:"phase,omitempty"`
	Input                json.RawMessage `json:"input,omitempty"`
	System               json.RawMessage `json:"system,omitempty"`
	Prompt               json.RawMessage `json:"prompt,omitempty"`
	Messages             json.RawMessage `json:"messages,omitempty"`
	AllMessages          json.RawMessage `json:"allMessages,omitempty"`
	InputMessages        json.RawMessage `json:"inputMessages,omitempty"`
	InputPrompt          json.RawMessage `json:"inputPrompt,omitempty"`
	Recent               json.RawMessage `json:"recent,omitempty"`
	ExistingResponses    json.RawMessage `json:"existingResponses,omitempty"`
	Search               json.RawMessage `json:"search,omitempty"`
	PreviousStepMessages json.RawMessage `json:"previousStepMessages,omitempty"`
}

type RunDetailRequestContribution struct {
	Kind                   string          `json:"kind"`
	State                  string          `json:"state"`
	Included               bool            `json:"included"`
	SourceID               string          `json:"sourceId"`
	InjectableKind         string          `json:"injectableKind"`
	Reason                 string          `json:"reason,omitempty"`
	Branch                 string          `json:"branch,omitempty"`
	Injects                []string        `json:"injects,omitempty"`
	Priority               *float64        `json:"priority,omitempty"`
	SizeBytes              *float64        `json:"sizeBytes,omitempty"`
	Tokens                 *float64        `json:"tokens,omitempty"`
	CacheStatus            string          `json:"cacheStatus,omitempty"`
	CacheKey               string          `json:"cacheKey,omitempty"`
	CacheAgeMs             *float64        `json:"cacheAgeMs,omitempty"`
	CacheTTLMS             *float64        `json:"cacheTtlMs,omitempty"`
	CacheReason            string          `json:"cacheReason,omitempty"`
	InjectedTools          []string        `json:"injectedTools,omitempty"`
	Segments               json.RawMessage `json:"segments,omitempty"`
	StaticTokens           *float64        `json:"staticTokens,omitempty"`
	DynamicTokens          *float64        `json:"dynamicTokens,omitempty"`
	FreshnessStatus        string          `json:"freshnessStatus,omitempty"`
	FreshnessAgeMs         *float64        `json:"freshnessAgeMs,omitempty"`
	FreshnessMaxAgeMs      *float64        `json:"freshnessMaxAgeMs,omitempty"`
	FreshnessObservedAt    string          `json:"freshnessObservedAt,omitempty"`
	FreshnessValidUntil    string          `json:"freshnessValidUntil,omitempty"`
	FreshnessSourceVersion string          `json:"freshnessSourceVersion,omitempty"`
	FreshnessReason        string          `json:"freshnessReason,omitempty"`
	Text                   string          `json:"text,omitempty"`
	ArtifactID             string          `json:"artifactId,omitempty"`
	SourceSpanID           string          `json:"sourceSpanId,omitempty"`
	Order                  int             `json:"order"`
}

type RunDetailRequestBudget struct {
	ArtifactID   string                         `json:"artifactId,omitempty"`
	UsedTokens   *float64                       `json:"usedTokens,omitempty"`
	TotalTokens  *float64                       `json:"totalTokens,omitempty"`
	DroppedCount int                            `json:"droppedCount"`
	Dropped      []RunDetailRequestContribution `json:"dropped,omitempty"`
}

type RunDetailRequestTool struct {
	Name            string   `json:"name"`
	SourceIDs       []string `json:"sourceIds,omitempty"`
	InjectableKinds []string `json:"injectableKinds,omitempty"`
	Origin          string   `json:"origin"`
}

type RunDetailRequestTurn struct {
	SpanID      string `json:"spanId"`
	Primitive   string `json:"primitive"`
	Label       string `json:"label"`
	StartedAt   string `json:"startedAt,omitempty"`
	Status      string `json:"status"`
	RequestMode string `json:"requestMode"`
	Model       string `json:"model,omitempty"`
	Provider    string `json:"provider,omitempty"`
	PromptID    string `json:"promptId,omitempty"`
}

type RunDetailInspection map[string][]RunDetailInspectionItem

type RunDetailInspectionItem struct {
	Type         string          `json:"type"`
	ID           string          `json:"id"`
	Label        string          `json:"label,omitempty"`
	Kind         string          `json:"kind,omitempty"`
	Role         string          `json:"role,omitempty"`
	SourceSpanID string          `json:"sourceSpanId,omitempty"`
	Data         json.RawMessage `json:"data,omitempty"`
}

type RunDetailDisplay struct {
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Icon        string `json:"icon,omitempty"`
	Accent      string `json:"accent,omitempty"`
	Severity    string `json:"severity,omitempty"`
}

type RunDetailTiming struct {
	StartedAt  string  `json:"startedAt"`
	EndedAt    string  `json:"endedAt,omitempty"`
	DurationMs float64 `json:"durationMs"`
	SelfMs     float64 `json:"selfMs,omitempty"`
	ChildrenMs float64 `json:"childrenMs,omitempty"`
	DetailsMs  float64 `json:"detailsMs,omitempty"`
}

type RunDetailMetricBuckets struct {
	Own      json.RawMessage `json:"own,omitempty"`
	Children json.RawMessage `json:"children,omitempty"`
	Details  json.RawMessage `json:"details,omitempty"`
	Total    json.RawMessage `json:"total,omitempty"`
}

type RunDetailSource struct {
	PlacementReason       string `json:"placementReason"`
	OwnerSpanID           string `json:"ownerSpanId,omitempty"`
	CanonicalParentSpanID string `json:"canonicalParentSpanId,omitempty"`
}

type RunDetailDiagnostic struct {
	Code         string   `json:"code"`
	Severity     string   `json:"severity"`
	Message      string   `json:"message"`
	RecordIDs    []string `json:"recordIds,omitempty"`
	SpanIDs      []string `json:"spanIds,omitempty"`
	SuggestedFix string   `json:"suggestedFix,omitempty"`
}

type RunDetailRow struct {
	NodeID          string           `json:"nodeId"`
	SpanID          string           `json:"spanId,omitempty"`
	ParentID        string           `json:"parentId"`
	Depth           int              `json:"depth"`
	Path            []string         `json:"path"`
	HasChildren     bool             `json:"hasChildren"`
	ExpandedDefault bool             `json:"expandedDefault"`
	Display         RunDetailDisplay `json:"display"`
	Status          string           `json:"status"`
	Model           string           `json:"model,omitempty"`
	Provider        string           `json:"provider,omitempty"`
	Timing          RunDetailTiming  `json:"timing"`
	Match           bool             `json:"match,omitempty"`
}

type RunDetailPlacement struct {
	Placement   string   `json:"placement"`
	NodeID      string   `json:"nodeId,omitempty"`
	OwnerNodeID string   `json:"ownerNodeId,omitempty"`
	Path        []string `json:"path"`
	Reason      string   `json:"reason,omitempty"`
}

type StoredRecord struct {
	RecordID    string     `json:"recordId"`
	RunID       string     `json:"runId"`
	TraceID     string     `json:"traceId"`
	SegmentID   string     `json:"segmentId"`
	SegmentSeq  int        `json:"segmentSeq"`
	Type        RecordType `json:"type"`
	PayloadJSON string     `json:"payloadJson"`
	ReceivedAt  string     `json:"receivedAt"`
}

type SpanSummary struct {
	SpanID       string          `json:"spanId"`
	RunID        string          `json:"runId"`
	TraceID      string          `json:"traceId"`
	ParentSpanID string          `json:"parentSpanId"`
	Family       string          `json:"family"`
	Primitive    string          `json:"primitive"`
	Name         string          `json:"name"`
	Status       string          `json:"status"`
	StartedAt    string          `json:"startedAt"`
	EndedAt      string          `json:"endedAt"`
	DurationMs   float64         `json:"durationMs"`
	Model        string          `json:"model"`
	Provider     string          `json:"provider"`
	PromptID     string          `json:"promptId"`
	ContextID    string          `json:"contextId"`
	AgentID      string          `json:"agentId"`
	ToolName     string          `json:"toolName"`
	FlowID       string          `json:"flowId"`
	StepID       string          `json:"stepId"`
	MemoryID     string          `json:"memoryId"`
	RetrieverID  string          `json:"retrieverId"`
	Attributes   json.RawMessage `json:"attributes,omitempty"`
	Metrics      json.RawMessage `json:"metrics,omitempty"`
	Error        json.RawMessage `json:"error,omitempty"`
}

type SpanEventSummary struct {
	EventID    string          `json:"eventId"`
	RunID      string          `json:"runId"`
	TraceID    string          `json:"traceId"`
	SpanID     string          `json:"spanId"`
	Name       string          `json:"name"`
	Timestamp  string          `json:"timestamp"`
	Attributes json.RawMessage `json:"attributes,omitempty"`
}

type ArtifactSummary struct {
	ArtifactID  string          `json:"artifactId"`
	RunID       string          `json:"runId"`
	TraceID     string          `json:"traceId"`
	SpanID      string          `json:"spanId"`
	Kind        string          `json:"kind"`
	CreatedAt   string          `json:"createdAt"`
	ContentType string          `json:"contentType"`
	Encoding    string          `json:"encoding"`
	SizeBytes   int64           `json:"sizeBytes"`
	Hash        string          `json:"hash"`
	URI         string          `json:"uri"`
	Preview     json.RawMessage `json:"preview,omitempty"`
	Attributes  json.RawMessage `json:"attributes,omitempty"`
}

type EdgeSummary struct {
	EdgeID     string          `json:"edgeId"`
	RunID      string          `json:"runId"`
	TraceID    string          `json:"traceId"`
	EdgeType   string          `json:"edgeType"`
	From       NodeRef         `json:"from"`
	To         NodeRef         `json:"to"`
	CreatedAt  string          `json:"createdAt"`
	Attributes json.RawMessage `json:"attributes,omitempty"`
}

type RunEndRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	SegmentID     string          `json:"segmentId,omitempty"`
	SegmentSeq    int             `json:"segmentSeq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	EndedAt       string          `json:"endedAt"`
	DurationMs    float64         `json:"durationMs,omitempty"`
	Status        string          `json:"status"`
	Metrics       json.RawMessage `json:"metrics,omitempty"`
	Error         json.RawMessage `json:"error,omitempty"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type SpanEndRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	SegmentID     string          `json:"segmentId,omitempty"`
	SegmentSeq    int             `json:"segmentSeq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	SpanID        string          `json:"spanId"`
	EndedAt       string          `json:"endedAt"`
	DurationMs    float64         `json:"durationMs,omitempty"`
	Status        string          `json:"status"`
	Metrics       json.RawMessage `json:"metrics,omitempty"`
	Error         json.RawMessage `json:"error,omitempty"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type SpanEventRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	SegmentID     string          `json:"segmentId,omitempty"`
	SegmentSeq    int             `json:"segmentSeq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	SpanID        string          `json:"spanId"`
	EventID       string          `json:"eventId"`
	Name          string          `json:"name"`
	Timestamp     string          `json:"timestamp"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

func NewService(db *sql.DB) (*Service, error) {
	return newService(context.Background(), db, inMemoryMaxOpenConns)
}

func newService(ctx context.Context, db *sql.DB, maxOpenConns int) (*Service, error) {
	configureConnectionPool(db, maxOpenConns)
	service := &Service{
		db:                db,
		events:            NewEventBus(),
		queryTO:           defaultQueryTimeout,
		mutationTO:        defaultMutationTimeout,
		maintenanceTO:     defaultMaintenanceTimeout,
		retentionSettings: retentionSettingsFromEnv(),
	}
	service.lifecycleRunDetail = service.RunDetail
	ctx, cancel := service.maintenanceContext(ctx)
	defer cancel()

	if err := service.configureSQLite(ctx); err != nil {
		return nil, fmt.Errorf("configure observability sqlite: %w", err)
	}
	if err := service.migrate(ctx); err != nil {
		return nil, fmt.Errorf("migrate observability sqlite: %w", err)
	}
	return service, nil
}

func configureConnectionPool(db *sql.DB, maxOpenConns int) {
	if maxOpenConns <= 0 {
		maxOpenConns = inMemoryMaxOpenConns
	}
	db.SetMaxOpenConns(maxOpenConns)
	db.SetMaxIdleConns(maxOpenConns)
}

func contextWithOptionalTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return ctx, func() {}
	}
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
}

func (s *Service) queryContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return contextWithOptionalTimeout(ctx, s.queryTO)
}

func (s *Service) mutationContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return contextWithOptionalTimeout(ctx, s.mutationTO)
}

func (s *Service) maintenanceContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return contextWithOptionalTimeout(ctx, s.maintenanceTO)
}

func OpenService(ctx context.Context, path string) (*Service, error) {
	sqlitePath := path
	maxOpenConns := inMemoryMaxOpenConns
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, fmt.Errorf("create observability sqlite directory for %q: %w", path, err)
		}
		absPath, err := filepath.Abs(path)
		if err != nil {
			return nil, fmt.Errorf("resolve observability sqlite path %q: %w", path, err)
		}
		sqlitePath = observabilitySQLiteDSN(absPath)
		maxOpenConns = fileDatabaseMaxOpenConns
	}
	db, err := sql.Open("sqlite", sqlitePath)
	if err != nil {
		return nil, fmt.Errorf("open observability sqlite %q: %w", path, err)
	}
	service, err := newService(ctx, db, maxOpenConns)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize observability service: %w", err)
	}
	if _, err := service.runRetention(ctx, service.retentionSettings, time.Now().UTC()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("run observability retention: %w", err)
	}
	service.StartLifecycleReconciler(ctx, time.Second)
	service.StartRetention(ctx, 30*time.Minute)
	return service, nil
}

func observabilitySQLiteDSN(path string) string {
	query := url.Values{}
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "foreign_keys(ON)")
	query.Add("_pragma", "journal_mode(WAL)")

	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(path), RawQuery: query.Encode()}
	return dsn.String()
}

func (s *Service) Close() error {
	s.tokenMu.Lock()
	if s.tokenTimer != nil {
		s.tokenTimer.Stop()
		s.tokenTimer = nil
	}
	s.tokenMu.Unlock()
	return s.db.Close()
}

func (s *Service) Events() *EventBus {
	return s.events
}

func (s *Service) StartLifecycleReconciler(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.PublishLifecycleReconciliations(ctx); err != nil {
					// Reconciliation drives presentation freshness only; ingestion and reads
					// remain the source of canonical data and should never be blocked by it.
					slog.Debug("observability lifecycle reconciliation failed", "error", err)
				}
			}
		}
	}()
}

func (s *Service) PublishLifecycleReconciliations(ctx context.Context) error {
	ctx, cancel := s.maintenanceContext(ctx)
	defer cancel()

	reconciliations, err := s.lifecycleReconciliations(ctx)
	if err != nil {
		return err
	}
	if len(reconciliations) == 0 {
		return nil
	}

	now := time.Now().UnixMilli()
	for _, reconciliation := range reconciliations {
		persisted, err := s.persistLifecycleReconciliation(ctx, reconciliation)
		if err != nil {
			return err
		}
		if !persisted {
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"runId":  reconciliation.RunID,
			"status": reconciliation.Status,
			"reason": reconciliation.Reason,
		})
		s.events.Publish(Event{
			Tag:       "ObservabilityEvent",
			ID:        fmt.Sprintf("observability:lifecycle:%s:%d", reconciliation.RunID, now),
			Timestamp: now,
			Kind:      "observability.lifecycle",
			Action:    "reconciled",
			Severity:  reconciliation.Severity,
			RefID:     reconciliation.RunID,
			Payload:   payload,
		})
	}
	return nil
}

func (s *Service) lifecycleReconciliations(ctx context.Context) ([]lifecycleReconciliation, error) {
	runs, err := s.lifecycleCandidateRuns(ctx)
	if err != nil {
		return nil, fmt.Errorf("list runs for lifecycle reconciliation: %w", err)
	}
	reconciliations := make([]lifecycleReconciliation, 0)
	for _, run := range runs {
		if lifecycleActivityIsFresh(run.LastActivityAt, time.Now()) {
			continue
		}
		detail, err := s.lifecycleRunDetail(ctx, run.RunID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, fmt.Errorf("read run detail for lifecycle reconciliation %q: %w", run.RunID, err)
		}
		if detail.Run.Status == "" || detail.Run.Status == run.Status {
			if detail.Root.Status == "" || detail.Root.Status == run.Status {
				continue
			}
		}
		status, endedAt := lifecyclePresentationStatus(run, detail)
		if status == "" || (status == run.Status && endedAt == run.EndedAt) {
			continue
		}
		reason := lifecycleReconciliationReason(detail)
		severity := "warn"
		if status == "error" || status == "cancelled" {
			severity = "error"
		}
		reconciliations = append(reconciliations, lifecycleReconciliation{
			RunID:          run.RunID,
			Status:         status,
			EndedAt:        endedAt,
			Reason:         reason,
			Severity:       severity,
			Signature:      strings.Join([]string{status, endedAt, reason}, "|"),
			LastActivityAt: run.LastActivityAt,
		})
	}
	return reconciliations, nil
}

type lifecycleRunSummary struct {
	RunID          string
	Status         string
	EndedAt        string
	LastActivityAt string
}

func (s *Service) lifecycleCandidateRuns(ctx context.Context) ([]lifecycleRunSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id, ifnull(status, ''), ifnull(ended_at, ''), ifnull(last_activity_at, '')
		FROM runs
		WHERE status = 'running' AND lifecycle_status IS NULL
		ORDER BY coalesce(last_activity_at, started_at, '') DESC, run_id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var runs []lifecycleRunSummary
	for rows.Next() {
		var run lifecycleRunSummary
		if err := rows.Scan(&run.RunID, &run.Status, &run.EndedAt, &run.LastActivityAt); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Service) persistLifecycleReconciliation(ctx context.Context, reconciliation lifecycleReconciliation) (bool, error) {
	status := "reconciled-terminal"
	if reconciliation.Status == "incomplete" {
		status = "reconciled-incomplete"
	}
	checkedAt := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := s.db.ExecContext(ctx, `
		UPDATE runs
		SET lifecycle_status = ?, lifecycle_checked_at = ?
		WHERE run_id = ? AND lifecycle_status IS NULL AND ifnull(last_activity_at, '') = ?
	`, status, checkedAt, reconciliation.RunID, reconciliation.LastActivityAt)
	if err != nil {
		return false, fmt.Errorf("persist lifecycle reconciliation for %q: %w", reconciliation.RunID, err)
	}
	updated, err := rowsAffected(result)
	if err != nil {
		return false, fmt.Errorf("inspect lifecycle reconciliation update for %q: %w", reconciliation.RunID, err)
	}
	if !updated {
		return false, nil
	}
	return true, nil
}

func lifecycleActivityIsFresh(timestamp string, now time.Time) bool {
	if timestamp == "" {
		return false
	}
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return false
	}
	return now.Sub(parsed) <= 60*time.Second
}

func lifecyclePresentationStatus(run lifecycleRunSummary, detail RunDetail) (string, string) {
	status := detail.Run.Status
	endedAt := detail.Run.EndedAt
	if detail.Root.Status != "" && detail.Root.Status != run.Status {
		status = detail.Root.Status
		endedAt = detail.Root.Timing.EndedAt
	}
	return status, endedAt
}

func lifecycleReconciliationReason(detail RunDetail) string {
	for _, diagnostic := range detail.Diagnostics {
		if diagnostic.Code != "" {
			return diagnostic.Code
		}
	}
	return "presentation-reconciled"
}
