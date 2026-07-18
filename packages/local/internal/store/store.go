package store

import "sync"

// Default ring buffer capacities matching the TypeScript store.
const (
	DefaultMaxTraces               = 500
	DefaultMaxRuntimeFlowRuns      = 100
	DefaultMaxMemoryEvents         = 500
	DefaultMaxCompactEvents        = 200
	DefaultMaxBudgetSnapshots      = 200
	DefaultMaxCostEvents           = 500
	DefaultMaxAgentEvents          = 200
	DefaultMaxJudgeEvents          = 200
	DefaultMaxDelegateEvents       = 200
	DefaultMaxEmbeddingEvents      = 500
	DefaultMaxRetrievalEvents      = 500
	DefaultMaxRetrievalStageEvents = 500
	DefaultMaxWorkspaceEvents      = 500
	DefaultMaxIndexEvents          = 500
	DefaultMaxCorpusEvents         = 500
	DefaultMaxIngestEvents         = 500
	DefaultMaxToolEvents           = 500
	DefaultMaxSecurityEvents       = 500
	DefaultMaxCompositionEvents    = 200
	DefaultMaxPlanEvents           = 200
	DefaultMaxTaskListEvents       = 200
	DefaultMaxTaskEvents           = 500
	DefaultMaxConstraintChecks     = 500
	DefaultMaxConstraintRetries    = 200
	DefaultMaxConstraintViolations = 200
)

// Store is the in-memory event store for the devtools server.
// All public methods are thread-safe via a single RWMutex.
type Store struct {
	mu sync.RWMutex

	// Index
	index IndexData

	// Runtime flows — managed manually for index cleanup on eviction.
	runtimeFlowList  []*RuntimeFlowRunData
	maxRuntimeFlows  int
	runtimeFlowByKey map[string]*RuntimeFlowRunData // key = "flowId:sessionId"

	// Context cache counters
	contextCacheHits   int
	contextCacheMisses int

	// Semantic cache counters
	semanticCacheHits   int
	semanticCacheMisses int
	semanticCacheWrites int

	// Skill counters
	skillLoads       int
	skillCacheHits   int
	skillCacheMisses int
	skillResolves    int

	// Event ring buffers
	memoryEvents         *RingBuffer[MemoryEventData]
	compactEvents        *RingBuffer[CompactEventData]
	budgetSnapshots      *RingBuffer[BudgetSnapshotData]
	costEvents           *RingBuffer[CostEventData]
	agentEvents          *RingBuffer[AgentEventData]
	judgeEvents          *RingBuffer[JudgeEventData]
	delegateEvents       *RingBuffer[DelegateEventData]
	embeddingEvents      *RingBuffer[EmbeddingEventData]
	retrievalEvents      *RingBuffer[RetrievalEventData]
	retrievalStageEvents *RingBuffer[RetrievalStageEventData]
	workspaceEvents      *RingBuffer[WorkspaceEventData]
	indexEvents          *RingBuffer[IndexEventData]
	corpusEvents         *RingBuffer[CorpusEventData]
	ingestEvents         *RingBuffer[IngestEventData]
	toolEvents           *RingBuffer[ToolEventData]
	securityEvents       *RingBuffer[SecurityEventData]
	compositionEvents    *RingBuffer[CompositionEventData]
	planEvents           *RingBuffer[PlanEventData]
	taskListEvents       *RingBuffer[TaskListEventData]
	taskEvents           *RingBuffer[TaskEventData]
	guardrailRuns        *RingBuffer[GuardrailRunEvent]
	constraintChecks     *RingBuffer[ConstraintCheckEvent]
	constraintRetries    *RingBuffer[ConstraintRetryEvent]
	constraintViolations *RingBuffer[ConstraintViolationEvent]

	// Indexes
	memoryInstances map[string]*memoryInstance // memoryId → aggregated state

	// Subscribers for change notification (used by TUI)
	subscribers []chan struct{}
}

// memoryInstance tracks the internal aggregated state of a memory store.
type memoryInstance struct {
	memoryID      string
	memoryType    string
	blockID       string
	blockKind     string
	namespaceHash string
	readCount     int
	writeCount    int
	lastActivity  int64
	currentState  any
	entries       map[string]MemoryEntryData
}

// NewStore creates a new store with default ring buffer capacities.
func NewStore() *Store {
	return &Store{
		// Index
		index: IndexData{
			SchemaVersion: 1,
			Prompts:       []PromptMeta{},
			Contexts:      []ContextMeta{},
			Tools:         []ToolMeta{},
			Indexing:      DefaultIndexIndexingStatus(),
			Definitions:   []ProjectDefinition{},
			Relations:     []ProjectRelation{},
			Diagnostics:   []IndexDiagnostic{},
			LintFindings:  []IndexLintFinding{},
			Sources:       []IndexSourceFile{},
		},

		// Runtime flows
		runtimeFlowList:  make([]*RuntimeFlowRunData, 0, DefaultMaxRuntimeFlowRuns),
		maxRuntimeFlows:  DefaultMaxRuntimeFlowRuns,
		runtimeFlowByKey: make(map[string]*RuntimeFlowRunData),

		// Event ring buffers
		memoryEvents:         NewRingBuffer[MemoryEventData](DefaultMaxMemoryEvents),
		compactEvents:        NewRingBuffer[CompactEventData](DefaultMaxCompactEvents),
		budgetSnapshots:      NewRingBuffer[BudgetSnapshotData](DefaultMaxBudgetSnapshots),
		costEvents:           NewRingBuffer[CostEventData](DefaultMaxCostEvents),
		agentEvents:          NewRingBuffer[AgentEventData](DefaultMaxAgentEvents),
		judgeEvents:          NewRingBuffer[JudgeEventData](DefaultMaxJudgeEvents),
		delegateEvents:       NewRingBuffer[DelegateEventData](DefaultMaxDelegateEvents),
		embeddingEvents:      NewRingBuffer[EmbeddingEventData](DefaultMaxEmbeddingEvents),
		retrievalEvents:      NewRingBuffer[RetrievalEventData](DefaultMaxRetrievalEvents),
		retrievalStageEvents: NewRingBuffer[RetrievalStageEventData](DefaultMaxRetrievalStageEvents),
		workspaceEvents:      NewRingBuffer[WorkspaceEventData](DefaultMaxWorkspaceEvents),
		indexEvents:          NewRingBuffer[IndexEventData](DefaultMaxIndexEvents),
		corpusEvents:         NewRingBuffer[CorpusEventData](DefaultMaxCorpusEvents),
		ingestEvents:         NewRingBuffer[IngestEventData](DefaultMaxIngestEvents),
		toolEvents:           NewRingBuffer[ToolEventData](DefaultMaxToolEvents),
		securityEvents:       NewRingBuffer[SecurityEventData](DefaultMaxSecurityEvents),
		compositionEvents:    NewRingBuffer[CompositionEventData](DefaultMaxCompositionEvents),
		planEvents:           NewRingBuffer[PlanEventData](DefaultMaxPlanEvents),
		taskListEvents:       NewRingBuffer[TaskListEventData](DefaultMaxTaskListEvents),
		taskEvents:           NewRingBuffer[TaskEventData](DefaultMaxTaskEvents),
		guardrailRuns:        NewRingBuffer[GuardrailRunEvent](500),
		constraintChecks:     NewRingBuffer[ConstraintCheckEvent](DefaultMaxConstraintChecks),
		constraintRetries:    NewRingBuffer[ConstraintRetryEvent](DefaultMaxConstraintRetries),
		constraintViolations: NewRingBuffer[ConstraintViolationEvent](DefaultMaxConstraintViolations),

		// Indexes
		memoryInstances: make(map[string]*memoryInstance),
	}
}

// Subscribe returns a channel that receives a signal whenever the store is mutated.
// Used by the TUI to know when to re-render.
func (s *Store) Subscribe() <-chan struct{} {
	s.mu.Lock()
	defer s.mu.Unlock()
	ch := make(chan struct{}, 1)
	s.subscribers = append(s.subscribers, ch)
	return ch
}

// notify sends a non-blocking signal to all subscribers.
// Must be called after any mutation, with the write lock released.
func (s *Store) notify() {
	for _, ch := range s.subscribers {
		select {
		case ch <- struct{}{}:
		default:
			// Non-blocking: if subscriber hasn't consumed the last signal, skip.
		}
	}
}

func (s *Store) mutate(fn func()) {
	s.mu.Lock()
	fn()
	s.mu.Unlock()
	s.notify()
}

func readRingItems[T any](buffer *RingBuffer[T]) []T {
	items := buffer.Items()
	if len(items) == 0 {
		return []T{}
	}
	return items
}
