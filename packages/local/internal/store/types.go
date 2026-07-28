package store

import "encoding/json"

// ----------------------------------------------------------------
// Event data types — stored in ring buffers, discriminated by Kind.
// These mirror the TypeScript union types in store.ts.
// ----------------------------------------------------------------

// MemoryEventData represents a memory:read or memory:write event.
type MemoryEventData struct {
	Kind           string          `json:"_kind"` // "read" | "write"
	SpanID         string          `json:"spanId,omitempty"`
	RunID          string          `json:"runId,omitempty"`
	MemoryID       string          `json:"memoryId"`
	MemoryType     string          `json:"memoryType"` // "working" | "episodic" | "semantic" | "block" | "blackboard"
	Operation      string          `json:"operation,omitempty"`
	BlockID        string          `json:"blockId,omitempty"`
	BlockKind      string          `json:"blockKind,omitempty"`
	NamespaceHash  string          `json:"namespaceHash,omitempty"`
	WriteMode      string          `json:"writeMode,omitempty"`
	ProposalStatus string          `json:"proposalStatus,omitempty"`
	TraceID        string          `json:"traceId,omitempty"`
	SessionID      string          `json:"sessionId,omitempty"`
	Timestamp      int64           `json:"timestamp"`
	Key            string          `json:"key,omitempty"`
	Query          string          `json:"query,omitempty"`
	Content        string          `json:"content,omitempty"`
	Metadata       map[string]any  `json:"metadata,omitempty"`
	Confidence     *float64        `json:"confidence,omitempty"`
	Score          *float64        `json:"score,omitempty"`
	Count          *int            `json:"count,omitempty"`
	DurationMs     *float64        `json:"durationMs,omitempty"`
	State          any             `json:"state,omitempty"` // For working memory reads
	Snapshot       json.RawMessage `json:"snapshot,omitempty"`
}

// CompactEventData represents a compact:start or compact:end event.
type CompactEventData struct {
	Kind           string   `json:"_kind"` // "start" | "end"
	TraceID        string   `json:"traceId,omitempty"`
	SessionID      string   `json:"sessionId,omitempty"`
	Timestamp      int64    `json:"timestamp"`
	Strategy       string   `json:"strategy,omitempty"`
	InputTokens    *int     `json:"inputTokens,omitempty"`
	OutputTokens   *int     `json:"outputTokens,omitempty"`
	MessagesBefore *int     `json:"messagesBefore,omitempty"`
	MessagesAfter  *int     `json:"messagesAfter,omitempty"`
	DurationMs     *float64 `json:"durationMs,omitempty"`
}

// BudgetSnapshotData represents a budget:check event.
type BudgetSnapshotData struct {
	TraceID      string  `json:"traceId,omitempty"`
	SessionID    string  `json:"sessionId,omitempty"`
	Timestamp    int64   `json:"timestamp"`
	Level        string  `json:"level"` // "normal" | "warning" | "critical"
	UsedTokens   int     `json:"usedTokens"`
	BudgetTokens int     `json:"budgetTokens"`
	UsagePercent float64 `json:"usagePercent"`
}

// CostEventData represents a cost:report, cost:warn, or cost:limit event.
type CostEventData struct {
	Kind      string         `json:"_kind"` // "report" | "warn" | "limit"
	TraceID   string         `json:"traceId,omitempty"`
	SessionID string         `json:"sessionId,omitempty"`
	Timestamp int64          `json:"timestamp"`
	Threshold *float64       `json:"threshold,omitempty"`
	Actual    *float64       `json:"actual,omitempty"`
	Entry     map[string]any `json:"entry,omitempty"`
	Report    map[string]any `json:"report,omitempty"`
}

// AgentEventData represents a blackboard:update or handoff:prepare event.
type AgentEventData struct {
	Kind      string         `json:"_kind"` // "blackboard" | "handoff"
	TraceID   string         `json:"traceId,omitempty"`
	SessionID string         `json:"sessionId,omitempty"`
	Timestamp int64          `json:"timestamp"`
	Data      map[string]any `json:"data,omitempty"`
	// Handoff-specific fields
	InputSize  *int `json:"inputSize,omitempty"`
	OutputSize *int `json:"outputSize,omitempty"`
}

// JudgeEventData represents a judge:result event.
type JudgeEventData struct {
	TraceID   string  `json:"traceId,omitempty"`
	SessionID string  `json:"sessionId,omitempty"`
	Timestamp int64   `json:"timestamp"`
	Metric    string  `json:"metric"`
	Score     float64 `json:"score"`
	Reasoning string  `json:"reasoning,omitempty"`
	Model     string  `json:"model,omitempty"`
}

// DelegateEventData represents a delegate:start or delegate:complete event.
type DelegateEventData struct {
	Kind       string   `json:"_kind"` // "start" | "complete"
	TraceID    string   `json:"traceId,omitempty"`
	SessionID  string   `json:"sessionId,omitempty"`
	Timestamp  int64    `json:"timestamp"`
	AgentID    string   `json:"agentId"`
	DurationMs *float64 `json:"durationMs,omitempty"`
}

// EmbeddingEventData represents an embed:start or embed:end event.
type EmbeddingEventData struct {
	Kind            string   `json:"_kind"` // "start" | "end"
	TraceID         string   `json:"traceId,omitempty"`
	SessionID       string   `json:"sessionId,omitempty"`
	Timestamp       int64    `json:"timestamp"`
	EmbedID         string   `json:"embedId"`
	Name            string   `json:"name"`
	EmbeddingKind   string   `json:"kind"`
	Operation       string   `json:"operation"`
	InputCount      int      `json:"inputCount"`
	ChunkCount      int      `json:"chunkCount"`
	MaxChunkSize    int      `json:"maxChunkSize"`
	Dimensions      *int     `json:"dimensions,omitempty"`
	DurationMs      *float64 `json:"durationMs,omitempty"`
	InputTokens     *int     `json:"inputTokens,omitempty"`
	TotalTokens     *int     `json:"totalTokens,omitempty"`
	Cost            *float64 `json:"cost,omitempty"`
	CacheHitCount   *int     `json:"cacheHitCount,omitempty"`
	CacheMissCount  *int     `json:"cacheMissCount,omitempty"`
	RetryCount      *int     `json:"retryCount,omitempty"`
	TruncatedCount  *int     `json:"truncatedCount,omitempty"`
	RateLimitWaitMs *float64 `json:"rateLimitWaitMs,omitempty"`
	Error           *string  `json:"error,omitempty"`
}

// RetrievalEventData represents a retrieval:start or retrieval:end event.
type RetrievalEventData struct {
	Kind        string         `json:"_kind"` // "start" | "end"
	TraceID     string         `json:"traceId,omitempty"`
	SessionID   string         `json:"sessionId,omitempty"`
	Timestamp   int64          `json:"timestamp"`
	RetrievalID string         `json:"retrievalId"`
	RetrieverID string         `json:"retrieverId"`
	Namespace   string         `json:"namespace"`
	Mode        string         `json:"mode"`
	Query       string         `json:"query"`
	Limit       *int           `json:"limit,omitempty"`
	Threshold   *float64       `json:"threshold,omitempty"`
	Filter      map[string]any `json:"filter,omitempty"`
	Fusion      *string        `json:"fusion,omitempty"`
	ResultCount *int           `json:"resultCount,omitempty"`
	DurationMs  *float64       `json:"durationMs,omitempty"`
	Error       *string        `json:"error,omitempty"`
}

// RetrievalStageEventData represents a retrieval pipeline stage event.
type RetrievalStageEventData struct {
	Kind             string                 `json:"_kind"` // "stage-start" | "stage-end"
	TraceID          string                 `json:"traceId,omitempty"`
	SessionID        string                 `json:"sessionId,omitempty"`
	Timestamp        int64                  `json:"timestamp"`
	RetrievalID      string                 `json:"retrievalId"`
	RetrieverID      string                 `json:"retrieverId"`
	PipelineID       string                 `json:"pipelineId"`
	StageName        string                 `json:"stageName"`
	StageKind        string                 `json:"stageKind"`
	Phase            string                 `json:"phase"`
	Status           *string                `json:"status,omitempty"`
	InputQueryCount  *int                   `json:"inputQueryCount,omitempty"`
	OutputQueryCount *int                   `json:"outputQueryCount,omitempty"`
	InputHitCount    *int                   `json:"inputHitCount,omitempty"`
	OutputHitCount   *int                   `json:"outputHitCount,omitempty"`
	DurationMs       *float64               `json:"durationMs,omitempty"`
	WarningCount     *int                   `json:"warningCount,omitempty"`
	Error            *string                `json:"error,omitempty"`
	Preview          *RetrievalStagePreview `json:"preview,omitempty"`
}

// WorkspaceEventData represents a workspace:operation event.
type WorkspaceEventData struct {
	TraceID        string  `json:"traceId,omitempty"`
	SessionID      string  `json:"sessionId,omitempty"`
	Timestamp      int64   `json:"timestamp"`
	WorkspaceID    string  `json:"workspaceId"`
	Namespace      string  `json:"namespace"`
	Operation      string  `json:"operation"`
	Path           string  `json:"path"`
	PathHash       string  `json:"pathHash,omitempty"`
	FromPath       string  `json:"fromPath,omitempty"`
	FromPathHash   string  `json:"fromPathHash,omitempty"`
	Status         string  `json:"status"`
	DurationMs     float64 `json:"durationMs"`
	Mount          string  `json:"mount,omitempty"`
	MimeType       string  `json:"mimeType,omitempty"`
	Size           *int    `json:"size,omitempty"`
	FileCount      *int    `json:"fileCount,omitempty"`
	SizeBytes      *int    `json:"sizeBytes,omitempty"`
	SnapshotCount  *int    `json:"snapshotCount,omitempty"`
	RestoredFiles  *int    `json:"restoredFiles,omitempty"`
	DeletedFiles   *int    `json:"deletedFiles,omitempty"`
	UnchangedFiles *int    `json:"unchangedFiles,omitempty"`
	ArtifactStatus string  `json:"artifactStatus,omitempty"`
	ArtifactKind   string  `json:"artifactKind,omitempty"`
	URI            string  `json:"uri,omitempty"`
	Error          *string `json:"error,omitempty"`
	ErrorCode      string  `json:"errorCode,omitempty"`
}

// IndexEventData represents an index:start or index:end event.
type IndexEventData struct {
	Kind           string                   `json:"_kind"` // "start" | "end"
	TraceID        string                   `json:"traceId,omitempty"`
	SessionID      string                   `json:"sessionId,omitempty"`
	Timestamp      int64                    `json:"timestamp"`
	IndexID        string                   `json:"indexId"`
	IndexerID      string                   `json:"indexerId"`
	Namespace      string                   `json:"namespace"`
	Operation      string                   `json:"operation"`
	SourceCount    int                      `json:"sourceCount"`
	ChunkCount     int                      `json:"chunkCount"`
	ReplaceSources *bool                    `json:"replaceSources,omitempty"`
	SourceID       *string                  `json:"sourceId,omitempty"`
	DryRun         *bool                    `json:"dryRun,omitempty"`
	DurationMs     *float64                 `json:"durationMs,omitempty"`
	DeletedCount   *int                     `json:"deletedCount,omitempty"`
	Stages         []SourceStageEventRecord `json:"stages,omitempty"`
	Error          *string                  `json:"error,omitempty"`
}

// CorpusEventData represents corpus:sync:* and corpus:source:* events.
type CorpusEventData struct {
	Kind        string                   `json:"_kind"` // "sync:start" | "source" | "sync:end"
	Type        string                   `json:"type,omitempty"`
	SyncID      string                   `json:"syncId"`
	CorpusID    string                   `json:"corpusId"`
	Namespace   string                   `json:"namespace"`
	Mode        string                   `json:"mode,omitempty"`
	StalePolicy string                   `json:"stalePolicy,omitempty"`
	SourceSet   string                   `json:"sourceSet,omitempty"`
	DryRun      bool                     `json:"dryRun"`
	SourceCount *int                     `json:"sourceCount,omitempty"`
	SourceID    string                   `json:"sourceId,omitempty"`
	Action      string                   `json:"action,omitempty"`
	Reason      string                   `json:"reason,omitempty"`
	ChunkCount  *int                     `json:"chunkCount,omitempty"`
	Stages      []SourceStageEventRecord `json:"stages,omitempty"`
	Added       *int                     `json:"added,omitempty"`
	Changed     *int                     `json:"changed,omitempty"`
	Unchanged   *int                     `json:"unchanged,omitempty"`
	Stale       *int                     `json:"stale,omitempty"`
	Skipped     *int                     `json:"skipped,omitempty"`
	Deleted     *int                     `json:"deleted,omitempty"`
	Failed      *int                     `json:"failed,omitempty"`
	DurationMs  *float64                 `json:"durationMs,omitempty"`
	Error       *string                  `json:"error,omitempty"`
	TraceID     string                   `json:"traceId,omitempty"`
	SessionID   string                   `json:"sessionId,omitempty"`
	Timestamp   int64                    `json:"timestamp"`
}

// IngestEventData represents ingest:parse:start or ingest:parse:end events.
type IngestEventData struct {
	Kind         string   `json:"_kind"` // "start" | "end"
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

// ToolEventData represents tool execution and approval events.
type ToolEventData struct {
	Kind                 string          `json:"_kind"` // "start" | "end" | "approval-request" | "approval-decision"
	TraceID              string          `json:"traceId,omitempty"`
	SessionID            string          `json:"sessionId,omitempty"`
	Timestamp            int64           `json:"timestamp"`
	ToolName             string          `json:"toolName"`
	ToolCallID           string          `json:"toolCallId,omitempty"`
	ApprovalID           string          `json:"approvalId,omitempty"`
	Approved             *bool           `json:"approved,omitempty"`
	DurationMs           *float64        `json:"durationMs,omitempty"`
	Result               json.RawMessage `json:"result,omitempty"`
	ModelOutput          json.RawMessage `json:"modelOutput,omitempty"`
	ModelOutputType      string          `json:"modelOutputType,omitempty"`
	OutputSize           *int            `json:"outputSize,omitempty"`
	ModelOutputSize      *int            `json:"modelOutputSize,omitempty"`
	TokenSavingsEstimate *int            `json:"tokenSavingsEstimate,omitempty"`
	ModelOutputError     *string         `json:"modelOutputError,omitempty"`
	Error                *string         `json:"error,omitempty"`
}

// SecurityEventData represents a security:warning event.
type SecurityEventData struct {
	TraceID   string `json:"traceId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Timestamp int64  `json:"timestamp"`
	PromptID  string `json:"promptId,omitempty"`
	Pattern   string `json:"pattern"`
	Severity  string `json:"severity"`
	Message   string `json:"message,omitempty"`
}

// CompositionEventData represents a composition:start, :agent, or :end event.
type CompositionEventData struct {
	Kind            string   `json:"_kind"` // "start" | "agent" | "end"
	CompositionID   string   `json:"compositionId"`
	TraceID         string   `json:"traceId,omitempty"`
	SessionID       string   `json:"sessionId,omitempty"`
	Timestamp       int64    `json:"timestamp"`
	CompositionKind string   `json:"kind,omitempty"`   // "parallel" | "pipeline" | "consensus" | "swarm"
	Status          string   `json:"status,omitempty"` // For end events
	DurationMs      *float64 `json:"durationMs,omitempty"`
	AgentCount      *int     `json:"agentCount,omitempty"`
	HandoffCount    *int     `json:"handoffCount,omitempty"`
	HandoffPath     []string `json:"handoffPath,omitempty"`
	AgentID         string   `json:"agentId,omitempty"` // For agent events
	AgentDurationMs *float64 `json:"agentDurationMs,omitempty"`
}

// PlanEventData represents a plan:created or plan:updated event.
type PlanEventData struct {
	Kind      string         `json:"_kind"` // "created" | "updated"
	TraceID   string         `json:"traceId,omitempty"`
	SessionID string         `json:"sessionId,omitempty"`
	Timestamp int64          `json:"timestamp"`
	PlanID    string         `json:"planId"`
	Data      map[string]any `json:"data,omitempty"`
}

// TaskListEventData represents a tasklist:created, :completed, or :discarded event.
type TaskListEventData struct {
	Kind       string         `json:"_kind"` // "created" | "completed" | "discarded"
	TraceID    string         `json:"traceId,omitempty"`
	SessionID  string         `json:"sessionId,omitempty"`
	Timestamp  int64          `json:"timestamp"`
	TaskListID string         `json:"taskListId"`
	Data       map[string]any `json:"data,omitempty"`
}

// TaskEventData represents a task:added, :updated, or :removed event.
type TaskEventData struct {
	Kind       string         `json:"_kind"` // "added" | "updated" | "removed"
	TraceID    string         `json:"traceId,omitempty"`
	SessionID  string         `json:"sessionId,omitempty"`
	Timestamp  int64          `json:"timestamp"`
	TaskListID string         `json:"taskListId"`
	TaskID     string         `json:"taskId"`
	Data       map[string]any `json:"data,omitempty"`
}

// ----------------------------------------------------------------
// Memory instance types — aggregated view of memory store state.
// ----------------------------------------------------------------

// MemoryEntryData represents a single entry in a memory instance.
type MemoryEntryData struct {
	Key        string         `json:"key"`
	Content    string         `json:"content"`
	Metadata   map[string]any `json:"metadata,omitempty"`
	Confidence *float64       `json:"confidence,omitempty"`
	CreatedAt  *int64         `json:"createdAt,omitempty"`
	UpdatedAt  *int64         `json:"updatedAt,omitempty"`
	Score      *float64       `json:"score,omitempty"`
}

// MemoryInstanceData represents the aggregated state of a memory store.
type MemoryInstanceData struct {
	MemoryID      string            `json:"memoryId"`
	MemoryType    string            `json:"memoryType"`
	BlockID       string            `json:"blockId,omitempty"`
	BlockKind     string            `json:"blockKind,omitempty"`
	NamespaceHash string            `json:"namespaceHash,omitempty"`
	ReadCount     int               `json:"readCount"`
	WriteCount    int               `json:"writeCount"`
	LastActivity  int64             `json:"lastActivity"`
	CurrentState  any               `json:"currentState"`
	Entries       []MemoryEntryData `json:"entries"`
}

// ----------------------------------------------------------------
// Timeseries and aggregation types.
// ----------------------------------------------------------------

// TimeseriesBucket holds aggregated metrics for one time window.
type TimeseriesBucket struct {
	T             int64    `json:"t"`
	Executions    int      `json:"executions"`
	Errors        int      `json:"errors"`
	AvgDurationMs float64  `json:"avgDurationMs"`
	TotalCost     float64  `json:"totalCost"`
	AvgScore      *float64 `json:"avgScore"`
	BudgetLevel   *string  `json:"budgetLevel"`
}

// PromptBaseline holds baseline performance metrics for a prompt.
type PromptBaseline struct {
	PromptID      string  `json:"promptId"`
	AvgDurationMs float64 `json:"avgDurationMs"`
	AvgTokens     float64 `json:"avgTokens"`
	AvgCost       float64 `json:"avgCost"`
	TraceCount    int     `json:"traceCount"`
}

// JudgeTimeseriesBucket holds per-metric judge scores for one time window.
type JudgeTimeseriesBucket struct {
	T        int64                        `json:"t"`
	ByMetric map[string]JudgeMetricBucket `json:"byMetric"`
}

// JudgeMetricBucket holds aggregated judge scores for a single metric.
type JudgeMetricBucket struct {
	Avg   float64 `json:"avg"`
	Count int     `json:"count"`
}

// TimelineEvent is a generic event in the session timeline.
type TimelineEvent struct {
	Type      string         `json:"type"`
	Timestamp int64          `json:"timestamp"`
	TraceID   string         `json:"traceId,omitempty"`
	SessionID string         `json:"sessionId,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
}

// SessionInfo describes a session with its trace count and time range.
type SessionInfo struct {
	SessionID      string `json:"sessionId"`
	TraceCount     int    `json:"traceCount"`
	StartedAt      int64  `json:"startedAt"`
	LastActivityAt int64  `json:"lastActivityAt"`
}

// ----------------------------------------------------------------
// Runtime flow types — extended from api.RuntimeFlowRun.
// ----------------------------------------------------------------

// RuntimeFlowStepData holds data for a single step in a runtime flow.
type RuntimeFlowStepData struct {
	StepID        string     `json:"stepId"`
	Label         string     `json:"label"`
	Status        string     `json:"status"` // "started" | "completed" | "failed" | "skipped"
	Timestamp     int64      `json:"timestamp"`
	DurationMs    *float64   `json:"durationMs,omitempty"`
	TotalTokens   *int       `json:"totalTokens,omitempty"`
	Cost          *float64   `json:"cost,omitempty"`
	ToolCallNames []string   `json:"toolCallNames"`
	Actor         string     `json:"actor,omitempty"`
	FromStepID    string     `json:"fromStepId,omitempty"`
	HandoffKind   string     `json:"handoffKind,omitempty"`
	InputSummary  string     `json:"inputSummary,omitempty"`
	OutputSummary string     `json:"outputSummary,omitempty"`
	TraceID       string     `json:"traceId,omitempty"`
	Note          string     `json:"note,omitempty"`
	Source        *SourceLoc `json:"source,omitempty"`
}

// SourceLoc identifies a source code location.
type SourceLoc struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Column   *int   `json:"column,omitempty"`
	Function string `json:"function,omitempty"`
}

// SourceRange describes the source region captured for a index definition.
type SourceRange struct {
	File        string `json:"file"`
	StartLine   int    `json:"startLine"`
	EndLine     *int   `json:"endLine,omitempty"`
	StartColumn *int   `json:"startColumn,omitempty"`
	EndColumn   *int   `json:"endColumn,omitempty"`
}

// SourceSnippet is a bounded source-code preview for index inspection.
type SourceSnippet struct {
	Source    string      `json:"source"`
	Language  string      `json:"language,omitempty"`
	Range     SourceRange `json:"range"`
	Truncated bool        `json:"truncated,omitempty"`
}

// ProjectSourceRef points at supporting source code for a index definition,
// such as schema declarations or callback functions passed by reference.
type ProjectSourceRef struct {
	ID          string          `json:"id"`
	Role        string          `json:"role"`
	Property    string          `json:"property,omitempty"`
	Symbol      string          `json:"symbol,omitempty"`
	Source      SourceLoc       `json:"source"`
	Snippet     *SourceSnippet  `json:"snippet,omitempty"`
	Fidelity    string          `json:"fidelity"`
	Description string          `json:"description,omitempty"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
}

// RuntimeFlowRunData is the full store representation of a runtime flow.
type RuntimeFlowRunData struct {
	FlowID          string                `json:"flowId"`
	SessionID       string                `json:"sessionId"`
	Name            string                `json:"name"`
	Goal            string                `json:"goal,omitempty"`
	StartedAt       int64                 `json:"startedAt"`
	TriggerTraceID  string                `json:"triggerTraceId,omitempty"`
	RelatedTraceIDs []string              `json:"relatedTraceIds"`
	Steps           []RuntimeFlowStepData `json:"steps"`
	Status          string                `json:"status"` // "running" | "completed" | "failed" | "abandoned" | "suspended" | "cancelled" | "expired"
	DurationMs      *float64              `json:"durationMs,omitempty"`
	FinishedAt      *int64                `json:"finishedAt,omitempty"`
	Aggregate       *RuntimeFlowAggregate `json:"aggregate,omitempty"`
	Error           string                `json:"error,omitempty"`
	ParentFlowID    string                `json:"parentFlowId,omitempty"`
	SuspendedAt     string                `json:"suspendedAt,omitempty"`
	CancelReason    string                `json:"cancelReason,omitempty"`
}

// RuntimeFlowAggregate holds aggregate stats for a runtime flow.
type RuntimeFlowAggregate struct {
	TotalSteps  int      `json:"totalSteps"`
	TotalTokens *int     `json:"totalTokens,omitempty"`
	TotalCost   *float64 `json:"totalCost,omitempty"`
}

// ----------------------------------------------------------------
// Index types.
// ----------------------------------------------------------------

// PromptMeta describes a registered prompt in the index.
type PromptMeta struct {
	ID               string          `json:"id"`
	Description      string          `json:"description,omitempty"`
	Tags             []string        `json:"tags"`
	Path             []string        `json:"path"`
	ContextIDs       []string        `json:"contextIds"`
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
	Description      string          `json:"description,omitempty"`
	Priority         int             `json:"priority"`
	InputSchema      json.RawMessage `json:"inputSchema,omitempty"`
	IsStatic         bool            `json:"isStatic"`
	SystemTemplate   *string         `json:"systemTemplate,omitempty"`
	Path             []string        `json:"path"`
	UsedBy           []string        `json:"usedBy"`
	DefinitionSource *SourceLoc      `json:"definitionSource,omitempty"`
}

// ToolMeta describes a registered tool in the index.
type ToolMeta struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema,omitempty"`
	Path        []string        `json:"path"`
}

// IndexData holds all registered prompts, contexts, and tools.
type IndexData struct {
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
	SchemaVersion int                 `json:"schemaVersion"`
	ProducedBy    string              `json:"producedBy"`
	Capabilities  []string            `json:"capabilities"`
	Shards        []ProjectIndexShard `json:"shards,omitempty"`
}

// ProjectIndexShard is a package/workspace boundary used for Project Index planning.
type ProjectIndexShard struct {
	ID           string   `json:"id"`
	Root         string   `json:"root"`
	Name         string   `json:"name,omitempty"`
	PackageFile  string   `json:"packageFile,omitempty"`
	ConfigFile   string   `json:"configFile,omitempty"`
	DiscoveredBy string   `json:"discoveredBy,omitempty"`
	References   []string `json:"references,omitempty"`
}

// ProjectIdentity identifies the workspace that produced a Project Index.
type ProjectIdentity struct {
	Root              string                `json:"root"`
	Name              string                `json:"name,omitempty"`
	ConfigFile        string                `json:"configFile,omitempty"`
	RuntimeConfigured *bool                 `json:"runtimeConfigured,omitempty"`
	Observability     *ProjectObservability `json:"observability,omitempty"`
}

// ProjectObservability is the privacy-safe effective observability policy.
type ProjectObservability struct {
	RedactPatternsConfigured bool `json:"redactPatternsConfigured"`
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

// IndexLintConfig is the serialized project lint policy carried in the Project
// Index read model and consumed by Go read-model enrichers.
type IndexLintConfig struct {
	Profile string                         `json:"profile,omitempty"`
	Rules   map[string]IndexLintRuleConfig `json:"rules,omitempty"`
}

// IndexLintRuleConfig controls a single lint rule at project scope.
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
	ID                   string                        `json:"id"`
	Severity             string                        `json:"severity"`
	Code                 string                        `json:"code"`
	Message              string                        `json:"message"`
	Source               *SourceLoc                    `json:"source,omitempty"`
	RelatedDefinitionIDs []string                      `json:"relatedDefinitionIds,omitempty"`
	SuggestedFix         string                        `json:"suggestedFix,omitempty"`
	Evidence             *PromptTextDiagnosticEvidence `json:"evidence,omitempty"`
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
	ShardID       string   `json:"shardId,omitempty"`
	SourceHash    string   `json:"sourceHash,omitempty"`
	InterfaceHash string   `json:"interfaceHash,omitempty"`
	DefinitionIDs []string `json:"definitionIds,omitempty"`
	Dependencies  []string `json:"dependencies,omitempty"`
	Dependents    []string `json:"dependents,omitempty"`
	Diagnostics   []string `json:"diagnostics,omitempty"`
}

// ----------------------------------------------------------------
// Correlated event — ties events to traces.
// ----------------------------------------------------------------

// CorrelatedEvent is a generic event tied to a trace for the timeline.
type CorrelatedEvent struct {
	ID        string         `json:"id"`
	EventType string         `json:"eventType"`
	Timestamp int64          `json:"timestamp"`
	Data      map[string]any `json:"data"`
}

// ----------------------------------------------------------------
// Stats types — extended from api.Stats with additional fields.
// ----------------------------------------------------------------

// StatsResult holds aggregate statistics across all traces and events.
type StatsResult struct {
	TotalExecutions          int                        `json:"totalExecutions"`
	SuccessCount             int                        `json:"successCount"`
	ErrorCount               int                        `json:"errorCount"`
	RunningCount             int                        `json:"runningCount"`
	AvgDurationMs            float64                    `json:"avgDurationMs"`
	TotalCost                float64                    `json:"totalCost"`
	AvgCost                  float64                    `json:"avgCost"`
	TotalTokens              int                        `json:"totalTokens"`
	ErrorRate                float64                    `json:"errorRate"`
	MemoryReadCount          int                        `json:"memoryReadCount"`
	MemoryWriteCount         int                        `json:"memoryWriteCount"`
	MemoryByType             map[string]MemoryTypeStats `json:"memoryByType"`
	CompactionCount          int                        `json:"compactionCount"`
	BudgetLevel              *string                    `json:"budgetLevel"`
	JudgeAvgScore            *float64                   `json:"judgeAvgScore"`
	AvgTtftMs                *float64                   `json:"avgTtftMs"`
	AvgThroughput            *float64                   `json:"avgThroughput"`
	StreamingTraceCount      int                        `json:"streamingTraceCount"`
	HandoffCount             int                        `json:"handoffCount"`
	BlackboardUpdateCount    int                        `json:"blackboardUpdateCount"`
	DelegateCount            int                        `json:"delegateCount"`
	AvgDelegateDurationMs    *float64                   `json:"avgDelegateDurationMs"`
	AvgHandoffSizeBytes      *float64                   `json:"avgHandoffSizeBytes"`
	ToolExecutionCount       int                        `json:"toolExecutionCount"`
	ToolApprovalRequestCount int                        `json:"toolApprovalRequestCount"`
	ToolApprovalDeniedCount  int                        `json:"toolApprovalDeniedCount"`
	AvgToolDurationMs        *float64                   `json:"avgToolDurationMs"`
	ToolErrorCount           int                        `json:"toolErrorCount"`
	ToolTokenSavingsEstimate int                        `json:"toolTokenSavingsEstimate"`
	SecurityWarningCount     int                        `json:"securityWarningCount"`
	ContextCacheHitCount     int                        `json:"contextCacheHitCount"`
	ContextCacheMissCount    int                        `json:"contextCacheMissCount"`
	ContextCacheHitRate      *float64                   `json:"contextCacheHitRate"`
	SemanticCacheHitCount    int                        `json:"semanticCacheHitCount"`
	SemanticCacheMissCount   int                        `json:"semanticCacheMissCount"`
	SemanticCacheWriteCount  int                        `json:"semanticCacheWriteCount"`
	SemanticCacheHitRate     *float64                   `json:"semanticCacheHitRate"`
	SkillLoadCount           int                        `json:"skillLoadCount"`
	SkillCacheHitCount       int                        `json:"skillCacheHitCount"`
	SkillCacheMissCount      int                        `json:"skillCacheMissCount"`
	SkillResolveCount        int                        `json:"skillResolveCount"`
	EmbeddingCallCount       int                        `json:"embeddingCallCount"`
	TotalEmbeddingTexts      int                        `json:"totalEmbeddingTexts"`
	AvgEmbeddingDurationMs   *float64                   `json:"avgEmbeddingDurationMs"`
	TotalEmbeddingTokens     int                        `json:"totalEmbeddingTokens"`
	TotalEmbeddingCost       float64                    `json:"totalEmbeddingCost"`
	EmbeddingCacheHitCount   int                        `json:"embeddingCacheHitCount"`
	EmbeddingCacheMissCount  int                        `json:"embeddingCacheMissCount"`
	EmbeddingRetryCount      int                        `json:"embeddingRetryCount"`
	EmbeddingTruncatedCount  int                        `json:"embeddingTruncatedCount"`
	EmbeddingRateLimitWaitMs float64                    `json:"embeddingRateLimitWaitMs"`
	RetrievalCallCount       int                        `json:"retrievalCallCount"`
	RetrievalErrorCount      int                        `json:"retrievalErrorCount"`
	AvgRetrievalDurationMs   *float64                   `json:"avgRetrievalDurationMs"`
	TotalRetrievedHits       int                        `json:"totalRetrievedHits"`
	RetrievalStageCount      int                        `json:"retrievalStageCount"`
	RetrievalStageErrorCount int                        `json:"retrievalStageErrorCount"`
	WorkspaceOperationCount  int                        `json:"workspaceOperationCount"`
	WorkspaceErrorCount      int                        `json:"workspaceErrorCount"`
	IndexOperationCount      int                        `json:"indexOperationCount"`
	IndexErrorCount          int                        `json:"indexErrorCount"`
	AvgIndexDurationMs       *float64                   `json:"avgIndexDurationMs"`
	TotalIndexedSources      int                        `json:"totalIndexedSources"`
	TotalIndexedChunks       int                        `json:"totalIndexedChunks"`
	IngestParseCount         int                        `json:"ingestParseCount"`
	IngestErrorCount         int                        `json:"ingestErrorCount"`
	AvgIngestDurationMs      *float64                   `json:"avgIngestDurationMs"`
	TotalIngestParts         int                        `json:"totalIngestParts"`
	TotalIngestWarnings      int                        `json:"totalIngestWarnings"`
}

// MemoryTypeStats holds read/write counts for a memory type.
type MemoryTypeStats struct {
	Reads  int `json:"reads"`
	Writes int `json:"writes"`
}

// ----------------------------------------------------------------
// Dropped context frequency types.
// ----------------------------------------------------------------

// DroppedContextFrequency tracks how often a context is dropped.
type DroppedContextFrequency struct {
	Count       int `json:"count"`
	TotalTraces int `json:"totalTraces"`
}

// SecurityByPrompt tracks security warnings per prompt.
type SecurityByPrompt struct {
	Total     int            `json:"total"`
	ByPattern map[string]int `json:"byPattern"`
	LastSeen  int64          `json:"lastSeen"`
}

// ----------------------------------------------------------------
// Constraint event data types.
// ----------------------------------------------------------------

// ConstraintCheckEvent represents a constraint:check event.
// GuardrailRunEvent represents a guardrail:run event.
type GuardrailRunEvent struct {
	GuardrailID string  `json:"guardrailId"`
	Phase       string  `json:"phase"`
	Action      string  `json:"action"`
	Reason      string  `json:"reason,omitempty"`
	DurationMs  float64 `json:"durationMs"`
	TraceID     string  `json:"traceId,omitempty"`
	Timestamp   int64   `json:"timestamp"`
}

type ConstraintCheckEvent struct {
	ConstraintName string  `json:"constraintName"`
	Severity       string  `json:"severity"`
	Pass           bool    `json:"pass"`
	Feedback       string  `json:"feedback,omitempty"`
	DurationMs     float64 `json:"durationMs"`
	Attempt        int     `json:"attempt"`
	TraceID        string  `json:"traceId,omitempty"`
	Timestamp      int64   `json:"timestamp"`
}

// ConstraintRetryEvent represents a constraint:retry event.
type ConstraintRetryEvent struct {
	ConstraintNames  []string `json:"constraintNames"`
	Attempt          int      `json:"attempt"`
	CombinedFeedback string   `json:"combinedFeedback"`
	TraceID          string   `json:"traceId,omitempty"`
	Timestamp        int64    `json:"timestamp"`
}

// ConstraintViolationEvent represents a constraint:violation event.
type ConstraintViolationEvent struct {
	ConstraintNames []string `json:"constraintNames"`
	TotalAttempts   int      `json:"totalAttempts"`
	TraceID         string   `json:"traceId,omitempty"`
	Timestamp       int64    `json:"timestamp"`
}
