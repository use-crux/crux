package store

import "encoding/json"

// ----------------------------------------------------------------
// Context cache event types.
// ----------------------------------------------------------------

// ContextCacheHitEvent is the incoming event for context:cache:hit.
type ContextCacheHitEvent struct {
	ContextID string `json:"contextId"`
	CacheKey  string `json:"cacheKey"`
	AgeMs     int64  `json:"ageMs"`
	TraceID   string `json:"traceId,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// ContextCacheMissEvent is the incoming event for context:cache:miss.
type ContextCacheMissEvent struct {
	ContextID    string  `json:"contextId"`
	CacheKey     string  `json:"cacheKey"`
	ResolutionMs float64 `json:"resolutionMs"`
	TraceID      string  `json:"traceId,omitempty"`
	Timestamp    int64   `json:"timestamp"`
}

// SemanticCacheEvent is the incoming event payload for semantic-cache:* events.
type SemanticCacheEvent struct {
	CacheID    string   `json:"cacheId"`
	PromptID   string   `json:"promptId,omitempty"`
	Operation  string   `json:"operation,omitempty"`
	ScopeHash  string   `json:"scopeHash,omitempty"`
	Version    string   `json:"version,omitempty"`
	Threshold  *float64 `json:"threshold,omitempty"`
	DurationMs *float64 `json:"durationMs,omitempty"`
	Hit        *bool    `json:"hit,omitempty"`
	Score      *float64 `json:"score,omitempty"`
	AgeMs      *int64   `json:"ageMs,omitempty"`
	TTL        *int64   `json:"ttl,omitempty"`
	ResultKind string   `json:"resultKind,omitempty"`
	Reason     string   `json:"reason,omitempty"`
	Error      string   `json:"error,omitempty"`
	TraceID    string   `json:"traceId,omitempty"`
	Timestamp  int64    `json:"timestamp"`
}

// ----------------------------------------------------------------
// Skill event types.
// ----------------------------------------------------------------

// SkillLoadEvent is the incoming event for skill:load.
type SkillLoadEvent struct {
	SkillID   string `json:"skillId"`
	Source    string `json:"source"`
	TraceID   string `json:"traceId,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// SkillCacheHitEvent is the incoming event for skill:cache:hit.
type SkillCacheHitEvent struct {
	SkillID   string `json:"skillId"`
	TraceID   string `json:"traceId,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// SkillCacheMissEvent is the incoming event for skill:cache:miss.
type SkillCacheMissEvent struct {
	SkillID   string `json:"skillId"`
	TraceID   string `json:"traceId,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// SkillResolveEvent is the incoming event for skill:resolve.
type SkillResolveEvent struct {
	SkillID   string `json:"skillId"`
	TraceID   string `json:"traceId,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// ----------------------------------------------------------------
// Memory event types.
// ----------------------------------------------------------------

// MemoryReadEvent is the incoming event for memory:read.
type MemoryReadEvent struct {
	SpanID        string          `json:"spanId,omitempty"`
	RunID         string          `json:"runId,omitempty"`
	MemoryID      string          `json:"memoryId"`
	Operation     string          `json:"operation"`
	Query         string          `json:"query,omitempty"`
	ResultCount   int             `json:"resultCount"`
	Score         *float64        `json:"score,omitempty"`
	DurationMs    float64         `json:"durationMs"`
	TraceID       string          `json:"traceId,omitempty"`
	MemoryType    string          `json:"memoryType,omitempty"`
	BlockID       string          `json:"blockId,omitempty"`
	BlockKind     string          `json:"blockKind,omitempty"`
	NamespaceHash string          `json:"namespaceHash,omitempty"`
	Metadata      map[string]any  `json:"metadata,omitempty"`
	Snapshot      json.RawMessage `json:"snapshot,omitempty"`
	Timestamp     int64           `json:"timestamp"`
}

// MemoryWriteEvent is the incoming event for memory:write.
type MemoryWriteEvent struct {
	SpanID         string          `json:"spanId,omitempty"`
	RunID          string          `json:"runId,omitempty"`
	MemoryID       string          `json:"memoryId"`
	Operation      string          `json:"operation"`
	EntryKey       string          `json:"entryKey,omitempty"`
	TraceID        string          `json:"traceId,omitempty"`
	Content        string          `json:"content,omitempty"`
	MemoryType     string          `json:"memoryType,omitempty"`
	BlockID        string          `json:"blockId,omitempty"`
	BlockKind      string          `json:"blockKind,omitempty"`
	NamespaceHash  string          `json:"namespaceHash,omitempty"`
	WriteMode      string          `json:"writeMode,omitempty"`
	ProposalStatus string          `json:"proposalStatus,omitempty"`
	Metadata       map[string]any  `json:"metadata,omitempty"`
	Snapshot       json.RawMessage `json:"snapshot,omitempty"`
	Timestamp      int64           `json:"timestamp"`
}

// ----------------------------------------------------------------
// Compact event types.
// ----------------------------------------------------------------

// CompactStartEvent is the incoming event for compact:start.
type CompactStartEvent struct {
	Reason            string `json:"reason"`
	InputMessageCount int    `json:"inputMessageCount"`
	InputTokens       int    `json:"inputTokens"`
	TraceID           string `json:"traceId,omitempty"`
	Timestamp         int64  `json:"timestamp"`
}

// CompactEndEvent is the incoming event for compact:end.
type CompactEndEvent struct {
	OutputTokens     int     `json:"outputTokens"`
	CompressionRatio float64 `json:"compressionRatio"`
	DurationMs       float64 `json:"durationMs"`
	TraceID          string  `json:"traceId,omitempty"`
	Timestamp        int64   `json:"timestamp"`
}

// ----------------------------------------------------------------
// Budget event types.
// ----------------------------------------------------------------

// BudgetCheckEvent is the incoming event for budget:check.
type BudgetCheckEvent struct {
	Used      int            `json:"used"`
	Available int            `json:"available"`
	Level     string         `json:"level"`
	TraceID   string         `json:"traceId,omitempty"`
	Breakdown map[string]int `json:"breakdown,omitempty"`
	Timestamp int64          `json:"timestamp"`
}

// CostEvent is the incoming event for cost:report, cost:warn, and cost:limit.
type CostEvent struct {
	TraceID   string         `json:"traceId,omitempty"`
	Threshold *float64       `json:"threshold,omitempty"`
	Actual    *float64       `json:"actual,omitempty"`
	Entry     map[string]any `json:"entry,omitempty"`
	Report    map[string]any `json:"report,omitempty"`
	Timestamp int64          `json:"timestamp"`
}

// ----------------------------------------------------------------
// Agent coordination event types.
// ----------------------------------------------------------------

// BlackboardUpdateEvent is the incoming event for blackboard:update.
type BlackboardUpdateEvent struct {
	BoardID       string         `json:"boardId"`
	FieldsChanged []string       `json:"fieldsChanged"`
	TraceID       string         `json:"traceId,omitempty"`
	Snapshot      map[string]any `json:"snapshot,omitempty"`
	Timestamp     int64          `json:"timestamp"`
}

// HandoffPrepareEvent is the incoming event for handoff:prepare.
type HandoffPrepareEvent struct {
	HandoffID    string `json:"handoffId"`
	InputSize    int    `json:"inputSize"`
	OutputSize   int    `json:"outputSize"`
	TraceID      string `json:"traceId,omitempty"`
	Summary      string `json:"summary,omitempty"`
	FromAgent    string `json:"fromAgent,omitempty"`
	ToAgent      string `json:"toAgent,omitempty"`
	SpanID       string `json:"spanId,omitempty"`
	ParentSpanID string `json:"parentSpanId,omitempty"`
	Timestamp    int64  `json:"timestamp"`
}

// ----------------------------------------------------------------
// Judge event types.
// ----------------------------------------------------------------

// JudgeResultEvent is the incoming event for judge:result.
type JudgeResultEvent struct {
	MetricID  string  `json:"metricId"`
	Score     float64 `json:"score"`
	Reasoning string  `json:"reasoning,omitempty"`
	TraceID   string  `json:"traceId,omitempty"`
	Timestamp int64   `json:"timestamp"`
}

// ----------------------------------------------------------------
// Delegate event types.
// ----------------------------------------------------------------

// DelegateStartEvent is the incoming event for delegate:start.
type DelegateStartEvent struct {
	DelegateID   string `json:"delegateId"`
	HandoffID    string `json:"handoffId"`
	InputSize    int    `json:"inputSize"`
	TraceID      string `json:"traceId,omitempty"`
	SpanID       string `json:"spanId,omitempty"`
	ParentSpanID string `json:"parentSpanId,omitempty"`
	Timestamp    int64  `json:"timestamp"`
}

// DelegateCompleteEvent is the incoming event for delegate:complete.
type DelegateCompleteEvent struct {
	DelegateID string  `json:"delegateId"`
	HandoffID  string  `json:"handoffId"`
	InputSize  int     `json:"inputSize"`
	OutputSize int     `json:"outputSize"`
	DurationMs float64 `json:"durationMs"`
	TraceID    string  `json:"traceId,omitempty"`
	SpanID     string  `json:"spanId,omitempty"`
	Timestamp  int64   `json:"timestamp"`
}

// EmbedStartEvent is the incoming event for embed:start.
type EmbedStartEvent struct {
	EmbedID      string `json:"embedId"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	Operation    string `json:"operation"`
	InputCount   int    `json:"inputCount"`
	ChunkCount   int    `json:"chunkCount"`
	MaxChunkSize int    `json:"maxChunkSize"`
	Dimensions   *int   `json:"dimensions,omitempty"`
	TraceID      string `json:"traceId,omitempty"`
	Timestamp    int64  `json:"timestamp"`
}

// EmbedEndEvent is the incoming event for embed:end.
type EmbedEndEvent struct {
	EmbedID         string         `json:"embedId"`
	Name            string         `json:"name"`
	Kind            string         `json:"kind"`
	Operation       string         `json:"operation"`
	InputCount      int            `json:"inputCount"`
	ChunkCount      int            `json:"chunkCount"`
	MaxChunkSize    int            `json:"maxChunkSize"`
	Dimensions      *int           `json:"dimensions,omitempty"`
	DurationMs      float64        `json:"durationMs"`
	Usage           map[string]int `json:"usage,omitempty"`
	Cost            *float64       `json:"cost,omitempty"`
	CacheHitCount   *int           `json:"cacheHitCount,omitempty"`
	CacheMissCount  *int           `json:"cacheMissCount,omitempty"`
	RetryCount      *int           `json:"retryCount,omitempty"`
	TruncatedCount  *int           `json:"truncatedCount,omitempty"`
	RateLimitWaitMs *float64       `json:"rateLimitWaitMs,omitempty"`
	Error           string         `json:"error,omitempty"`
	TraceID         string         `json:"traceId,omitempty"`
	Timestamp       int64          `json:"timestamp"`
}

// RetrievalStartEvent is the incoming event for retrieval:start.
type RetrievalStartEvent struct {
	RetrievalID string         `json:"retrievalId"`
	RetrieverID string         `json:"retrieverId"`
	Namespace   string         `json:"namespace"`
	Mode        string         `json:"mode"`
	Query       string         `json:"query"`
	Limit       *int           `json:"limit,omitempty"`
	Threshold   *float64       `json:"threshold,omitempty"`
	Filter      map[string]any `json:"filter,omitempty"`
	Fusion      string         `json:"fusion,omitempty"`
	TraceID     string         `json:"traceId,omitempty"`
	Timestamp   int64          `json:"timestamp"`
}

// RetrievalEndEvent is the incoming event for retrieval:end.
type RetrievalEndEvent struct {
	RetrievalID string         `json:"retrievalId"`
	RetrieverID string         `json:"retrieverId"`
	Namespace   string         `json:"namespace"`
	Mode        string         `json:"mode"`
	Query       string         `json:"query"`
	Limit       *int           `json:"limit,omitempty"`
	Threshold   *float64       `json:"threshold,omitempty"`
	Filter      map[string]any `json:"filter,omitempty"`
	Fusion      string         `json:"fusion,omitempty"`
	ResultCount int            `json:"resultCount"`
	DurationMs  float64        `json:"durationMs"`
	Error       string         `json:"error,omitempty"`
	TraceID     string         `json:"traceId,omitempty"`
	Timestamp   int64          `json:"timestamp"`
}

// RetrievalStagePreview is a bounded preview for retrieval pipeline stage debugging.
type RetrievalStagePreview struct {
	Queries []map[string]any `json:"queries,omitempty"`
	Hits    []map[string]any `json:"hits,omitempty"`
}

// RetrievalStageStartEvent is the incoming event for retrieval:stage:start.
type RetrievalStageStartEvent struct {
	RetrievalID     string `json:"retrievalId"`
	RetrieverID     string `json:"retrieverId"`
	PipelineID      string `json:"pipelineId"`
	StageName       string `json:"stageName"`
	StageKind       string `json:"stageKind"`
	Phase           string `json:"phase"`
	InputQueryCount *int   `json:"inputQueryCount,omitempty"`
	InputHitCount   *int   `json:"inputHitCount,omitempty"`
	TraceID         string `json:"traceId,omitempty"`
	Timestamp       int64  `json:"timestamp"`
}

// RetrievalStageEndEvent is the incoming event for retrieval:stage:end.
type RetrievalStageEndEvent struct {
	RetrievalID      string                 `json:"retrievalId"`
	RetrieverID      string                 `json:"retrieverId"`
	PipelineID       string                 `json:"pipelineId"`
	StageName        string                 `json:"stageName"`
	StageKind        string                 `json:"stageKind"`
	Phase            string                 `json:"phase"`
	Status           string                 `json:"status"`
	InputQueryCount  *int                   `json:"inputQueryCount,omitempty"`
	OutputQueryCount *int                   `json:"outputQueryCount,omitempty"`
	InputHitCount    *int                   `json:"inputHitCount,omitempty"`
	OutputHitCount   *int                   `json:"outputHitCount,omitempty"`
	DurationMs       float64                `json:"durationMs"`
	WarningCount     *int                   `json:"warningCount,omitempty"`
	Error            string                 `json:"error,omitempty"`
	Preview          *RetrievalStagePreview `json:"preview,omitempty"`
	TraceID          string                 `json:"traceId,omitempty"`
	Timestamp        int64                  `json:"timestamp"`
}

// WorkspaceOperationEvent is the incoming event for workspace:operation.
type WorkspaceOperationEvent struct {
	WorkspaceID    string  `json:"workspaceId"`
	Namespace      string  `json:"namespace"`
	Operation      string  `json:"operation"`
	Path           string  `json:"path"`
	PathHash       string  `json:"pathHash,omitempty"`
	Status         string  `json:"status"`
	DurationMs     float64 `json:"durationMs"`
	Mount          string  `json:"mount,omitempty"`
	MimeType       string  `json:"mimeType,omitempty"`
	Size           *int    `json:"size,omitempty"`
	ArtifactStatus string  `json:"artifactStatus,omitempty"`
	ArtifactKind   string  `json:"artifactKind,omitempty"`
	URI            string  `json:"uri,omitempty"`
	Error          string  `json:"error,omitempty"`
	TraceID        string  `json:"traceId,omitempty"`
	SessionID      string  `json:"sessionId,omitempty"`
	Timestamp      int64   `json:"timestamp"`
}

// SourceStageEventRecord is a pipeline/source ledger entry attached to index and corpus events.
type SourceStageEventRecord struct {
	Name        string         `json:"name"`
	Kind        string         `json:"kind,omitempty"`
	Version     string         `json:"version,omitempty"`
	Status      string         `json:"status"`
	Cache       string         `json:"cache,omitempty"`
	Hash        string         `json:"hash,omitempty"`
	InputHash   string         `json:"inputHash,omitempty"`
	OutputHash  string         `json:"outputHash,omitempty"`
	DurationMs  *float64       `json:"durationMs,omitempty"`
	ChunkCount  *int           `json:"chunkCount,omitempty"`
	ParentCount *int           `json:"parentCount,omitempty"`
	Error       map[string]any `json:"error,omitempty"`
	UpdatedAt   int64          `json:"updatedAt"`
}

// IndexStartEvent is the incoming event for index:start.
type IndexStartEvent struct {
	IndexID        string `json:"indexId"`
	IndexerID      string `json:"indexerId"`
	Namespace      string `json:"namespace"`
	Operation      string `json:"operation"`
	SourceCount    int    `json:"sourceCount"`
	ChunkCount     int    `json:"chunkCount"`
	ReplaceSources *bool  `json:"replaceSources,omitempty"`
	SourceID       string `json:"sourceId,omitempty"`
	DryRun         *bool  `json:"dryRun,omitempty"`
	TraceID        string `json:"traceId,omitempty"`
	Timestamp      int64  `json:"timestamp"`
}

// IndexEndEvent is the incoming event for index:end.
type IndexEndEvent struct {
	IndexID        string                   `json:"indexId"`
	IndexerID      string                   `json:"indexerId"`
	Namespace      string                   `json:"namespace"`
	Operation      string                   `json:"operation"`
	SourceCount    int                      `json:"sourceCount"`
	ChunkCount     int                      `json:"chunkCount"`
	ReplaceSources *bool                    `json:"replaceSources,omitempty"`
	SourceID       string                   `json:"sourceId,omitempty"`
	DryRun         *bool                    `json:"dryRun,omitempty"`
	DurationMs     float64                  `json:"durationMs"`
	DeletedCount   *int                     `json:"deletedCount,omitempty"`
	Stages         []SourceStageEventRecord `json:"stages,omitempty"`
	Error          string                   `json:"error,omitempty"`
	TraceID        string                   `json:"traceId,omitempty"`
	Timestamp      int64                    `json:"timestamp"`
}

// CorpusSyncStartEvent is the incoming event for corpus:sync:start.
type CorpusSyncStartEvent struct {
	SyncID      string `json:"syncId"`
	CorpusID    string `json:"corpusId"`
	Namespace   string `json:"namespace"`
	Mode        string `json:"mode"`
	StalePolicy string `json:"stalePolicy"`
	SourceSet   string `json:"sourceSet"`
	DryRun      bool   `json:"dryRun"`
	SourceCount int    `json:"sourceCount"`
	TraceID     string `json:"traceId,omitempty"`
	Timestamp   int64  `json:"timestamp"`
}

// CorpusSourceEvent is the incoming event for corpus:source:*.
type CorpusSourceEvent struct {
	SyncID     string                   `json:"syncId"`
	CorpusID   string                   `json:"corpusId"`
	Namespace  string                   `json:"namespace"`
	SourceID   string                   `json:"sourceId"`
	Action     string                   `json:"action"`
	Reason     string                   `json:"reason,omitempty"`
	DryRun     bool                     `json:"dryRun"`
	ChunkCount *int                     `json:"chunkCount,omitempty"`
	Stages     []SourceStageEventRecord `json:"stages,omitempty"`
	Error      map[string]any           `json:"error,omitempty"`
	TraceID    string                   `json:"traceId,omitempty"`
	Timestamp  int64                    `json:"timestamp"`
}

// CorpusSyncEndEvent is the incoming event for corpus:sync:end.
type CorpusSyncEndEvent struct {
	SyncID      string  `json:"syncId"`
	CorpusID    string  `json:"corpusId"`
	Namespace   string  `json:"namespace"`
	Mode        string  `json:"mode"`
	StalePolicy string  `json:"stalePolicy"`
	SourceSet   string  `json:"sourceSet"`
	DryRun      bool    `json:"dryRun"`
	Added       int     `json:"added"`
	Changed     int     `json:"changed"`
	Unchanged   int     `json:"unchanged"`
	Stale       int     `json:"stale"`
	Skipped     int     `json:"skipped"`
	Deleted     int     `json:"deleted"`
	Failed      int     `json:"failed"`
	ChunkCount  int     `json:"chunkCount"`
	DurationMs  float64 `json:"durationMs"`
	TraceID     string  `json:"traceId,omitempty"`
	Timestamp   int64   `json:"timestamp"`
}

// IngestParseStartEvent is the incoming event for ingest:parse:start.
type IngestParseStartEvent struct {
	IngestID    string `json:"ingestId"`
	Parser      string `json:"parser"`
	Format      string `json:"format"`
	Namespace   string `json:"namespace"`
	SourceID    string `json:"sourceId"`
	ByteLength  int    `json:"byteLength"`
	ContentType string `json:"contentType,omitempty"`
	TraceID     string `json:"traceId,omitempty"`
	Timestamp   int64  `json:"timestamp"`
}

// IngestParseEndEvent is the incoming event for ingest:parse:end.
type IngestParseEndEvent struct {
	IngestID     string  `json:"ingestId"`
	Parser       string  `json:"parser"`
	Format       string  `json:"format"`
	Namespace    string  `json:"namespace"`
	SourceID     string  `json:"sourceId"`
	ByteLength   int     `json:"byteLength"`
	ContentType  string  `json:"contentType,omitempty"`
	DurationMs   float64 `json:"durationMs"`
	PartCount    int     `json:"partCount"`
	WarningCount int     `json:"warningCount"`
	Error        string  `json:"error,omitempty"`
	TraceID      string  `json:"traceId,omitempty"`
	Timestamp    int64   `json:"timestamp"`
}

// ----------------------------------------------------------------
// Tool event types.
// ----------------------------------------------------------------

// ToolStartEvent is the incoming event for tool:start.
type ToolStartEvent struct {
	ToolCallID   string `json:"toolCallId"`
	ToolName     string `json:"toolName"`
	TraceID      string `json:"traceId,omitempty"`
	SpanID       string `json:"spanId,omitempty"`
	ParentSpanID string `json:"parentSpanId,omitempty"`
	Timestamp    int64  `json:"timestamp"`
}

// ToolEndEvent is the incoming event for tool:end.
type ToolEndEvent struct {
	ToolCallID           string          `json:"toolCallId"`
	ToolName             string          `json:"toolName"`
	DurationMs           float64         `json:"durationMs"`
	Result               json.RawMessage `json:"result,omitempty"`
	ModelOutput          json.RawMessage `json:"modelOutput,omitempty"`
	ModelOutputType      string          `json:"modelOutputType,omitempty"`
	OutputSize           *int            `json:"outputSize,omitempty"`
	ModelOutputSize      *int            `json:"modelOutputSize,omitempty"`
	TokenSavingsEstimate *int            `json:"tokenSavingsEstimate,omitempty"`
	ModelOutputError     string          `json:"modelOutputError,omitempty"`
	Error                string          `json:"error,omitempty"`
	TraceID              string          `json:"traceId,omitempty"`
	SpanID               string          `json:"spanId,omitempty"`
	Timestamp            int64           `json:"timestamp"`
}

// ToolApprovalRequestEvent is the incoming event for tool:approval:request.
type ToolApprovalRequestEvent struct {
	ApprovalID string          `json:"approvalId"`
	ToolCallID string          `json:"toolCallId"`
	ToolName   string          `json:"toolName"`
	Input      json.RawMessage `json:"input,omitempty"`
	TraceID    string          `json:"traceId,omitempty"`
	Timestamp  int64           `json:"timestamp"`
}

// ToolApprovalDecisionEvent is the incoming event for tool:approval:decision.
type ToolApprovalDecisionEvent struct {
	ApprovalID string `json:"approvalId"`
	ToolCallID string `json:"toolCallId,omitempty"`
	ToolName   string `json:"toolName,omitempty"`
	Approved   bool   `json:"approved"`
	Reason     string `json:"reason,omitempty"`
	TraceID    string `json:"traceId,omitempty"`
	Timestamp  int64  `json:"timestamp"`
}

// ----------------------------------------------------------------
// Security event types.
// ----------------------------------------------------------------

// SecurityWarningEvent is the incoming event for security:warning.
type SecurityWarningEvent struct {
	PromptID     string `json:"promptId,omitempty"`
	Field        string `json:"field"`
	Pattern      string `json:"pattern"`
	Message      string `json:"message"`
	InputPreview string `json:"inputPreview,omitempty"`
	TraceID      string `json:"traceId,omitempty"`
	SessionID    string `json:"sessionId,omitempty"`
	Timestamp    int64  `json:"timestamp"`
}

// ----------------------------------------------------------------
// Composition event types.
// ----------------------------------------------------------------

// CompositionStartEvent is the incoming event for composition:start.
type CompositionStartEvent struct {
	CompositionID string   `json:"compositionId"`
	Kind          string   `json:"kind"`
	AgentIDs      []string `json:"agentIds"`
	TraceID       string   `json:"traceId,omitempty"`
	Timestamp     int64    `json:"timestamp"`
}

// CompositionAgentEvent is the incoming event for composition:agent.
type CompositionAgentEvent struct {
	CompositionID string  `json:"compositionId"`
	AgentID       string  `json:"agentId"`
	Status        string  `json:"status"`
	DurationMs    float64 `json:"durationMs"`
	TraceID       string  `json:"traceId,omitempty"`
	Timestamp     int64   `json:"timestamp"`
}

// CompositionEndEvent is the incoming event for composition:end.
type CompositionEndEvent struct {
	CompositionID string   `json:"compositionId"`
	Kind          string   `json:"kind"`
	Status        string   `json:"status"`
	DurationMs    float64  `json:"durationMs"`
	AgentCount    int      `json:"agentCount"`
	HandoffCount  *int     `json:"handoffCount,omitempty"`
	HandoffPath   []string `json:"handoffPath,omitempty"`
	Agreement     *float64 `json:"agreement,omitempty"`
	TraceID       string   `json:"traceId,omitempty"`
	Timestamp     int64    `json:"timestamp"`
}

// ----------------------------------------------------------------
// Plan event types.
// ----------------------------------------------------------------

// PlanCreatedEvent is the incoming event for plan:created.
type PlanCreatedEvent struct {
	PlanID    string `json:"planId"`
	Title     string `json:"title"`
	Status    string `json:"status,omitempty"`
	TraceID   string `json:"traceId,omitempty"`
	Timestamp int64  `json:"timestamp"`
}

// PlanUpdatedEvent is the incoming event for plan:updated.
type PlanUpdatedEvent struct {
	PlanID    string   `json:"planId"`
	Version   int      `json:"version"`
	Changes   []string `json:"changes,omitempty"`
	TraceID   string   `json:"traceId,omitempty"`
	Timestamp int64    `json:"timestamp"`
}

// ----------------------------------------------------------------
// Task list event types.
// ----------------------------------------------------------------

// TaskListCreatedEvent is the incoming event for tasklist:created.
type TaskListCreatedEvent struct {
	TaskListID string `json:"taskListId"`
	PlanID     string `json:"planId,omitempty"`
	TraceID    string `json:"traceId,omitempty"`
	Timestamp  int64  `json:"timestamp"`
}

// TaskListCompletedEvent is the incoming event for tasklist:completed.
type TaskListCompletedEvent struct {
	TaskListID string  `json:"taskListId"`
	TotalTasks int     `json:"totalTasks"`
	DurationMs float64 `json:"durationMs"`
	TraceID    string  `json:"traceId,omitempty"`
	Timestamp  int64   `json:"timestamp"`
}

// TaskListDiscardedEvent is the incoming event for tasklist:discarded.
type TaskListDiscardedEvent struct {
	TaskListID     string `json:"taskListId"`
	Reason         string `json:"reason,omitempty"`
	CompletedCount int    `json:"completedCount"`
	RemainingCount int    `json:"remainingCount"`
	TraceID        string `json:"traceId,omitempty"`
	Timestamp      int64  `json:"timestamp"`
}

// ----------------------------------------------------------------
// Task event types.
// ----------------------------------------------------------------

// TaskAddedEvent is the incoming event for task:added.
type TaskAddedEvent struct {
	TaskListID string         `json:"taskListId"`
	TaskID     string         `json:"taskId"`
	Label      string         `json:"label"`
	Assignee   map[string]any `json:"assignee,omitempty"`
	TraceID    string         `json:"traceId,omitempty"`
	Timestamp  int64          `json:"timestamp"`
}

// TaskUpdatedEvent is the incoming event for task:updated.
type TaskUpdatedEvent struct {
	TaskListID string   `json:"taskListId"`
	TaskID     string   `json:"taskId"`
	Status     string   `json:"status"`
	Progress   string   `json:"progress,omitempty"`
	DurationMs *float64 `json:"durationMs,omitempty"`
	TraceID    string   `json:"traceId,omitempty"`
	Timestamp  int64    `json:"timestamp"`
}

// TaskRemovedEvent is the incoming event for task:removed.
type TaskRemovedEvent struct {
	TaskListID string `json:"taskListId"`
	TaskID     string `json:"taskId"`
	TraceID    string `json:"traceId,omitempty"`
	Timestamp  int64  `json:"timestamp"`
}

// ================================================================
// Event handler methods.
// ================================================================
