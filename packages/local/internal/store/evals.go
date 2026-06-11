package store

import "encoding/json"

// EvalStartEvent is the incoming event for eval:start.
type EvalStartEvent struct {
	EvalID     string   `json:"evalId"`
	PromptID   *string  `json:"promptId,omitempty"`
	StartedAt  int64    `json:"startedAt"`
	Models     []string `json:"models"`
	CaseNames  []string `json:"caseNames"`
	TotalCases int      `json:"totalCases"`
}

// EvalCaseEvent is the incoming event for eval:case.
type EvalCaseEvent struct {
	EvalID          string                 `json:"evalId"`
	CaseName        string                 `json:"caseName"`
	ModelID         string                 `json:"modelId"`
	Passed          bool                   `json:"passed"`
	DurationMs      float64                `json:"durationMs"`
	Error           string                 `json:"error,omitempty"`
	Usage           json.RawMessage        `json:"usage,omitempty"`
	Cost            *float64               `json:"cost,omitempty"`
	TraceID         string                 `json:"traceId,omitempty"`
	Input           any                    `json:"input,omitempty"`
	Output          any                    `json:"output,omitempty"`
	Scores          map[string]ScoreResult `json:"scores,omitempty"`
	FailureCategory string                 `json:"failureCategory,omitempty"`
}

// EvalEndEvent is the incoming event for eval:end.
type EvalEndEvent struct {
	EvalID     string          `json:"evalId"`
	DurationMs float64         `json:"durationMs"`
	Summary    json.RawMessage `json:"summary,omitempty"`
}

// RagEvalStartEvent is the incoming event for rag-eval:start.
type RagEvalStartEvent struct {
	EvalID       string   `json:"evalId"`
	SuiteID      string   `json:"suiteId,omitempty"`
	CaseCount    int      `json:"caseCount"`
	ConfigLabels []string `json:"configLabels,omitempty"`
	Timestamp    int64    `json:"timestamp"`
}

// RagEvalCaseEvent is the incoming event for rag-eval:case.
type RagEvalCaseEvent struct {
	EvalID       string          `json:"evalId"`
	CaseID       string          `json:"caseId"`
	CaseName     string          `json:"caseName"`
	Status       string          `json:"status"`
	ConfigRole   string          `json:"configRole,omitempty"`
	ConfigLabel  string          `json:"configLabel,omitempty"`
	FailureTypes []string        `json:"failureTypes"`
	DurationMs   float64         `json:"durationMs"`
	Metrics      json.RawMessage `json:"metrics,omitempty"`
	Retrieval    json.RawMessage `json:"retrieval,omitempty"`
	Answer       json.RawMessage `json:"answer,omitempty"`
	Citations    json.RawMessage `json:"citations,omitempty"`
	Trace        json.RawMessage `json:"trace,omitempty"`
	Error        string          `json:"error,omitempty"`
}

// RagEvalEndEvent is the incoming event for rag-eval:end.
type RagEvalEndEvent struct {
	EvalID  string          `json:"evalId"`
	Status  string          `json:"status"`
	Summary json.RawMessage `json:"summary,omitempty"`
}

// EvalStart creates a new eval run.
func (s *Store) EvalStart(event EvalStartEvent) {
	s.mu.Lock()

	models := event.Models
	if models == nil {
		models = []string{}
	}
	caseNames := event.CaseNames
	if caseNames == nil {
		caseNames = []string{}
	}

	run := &EvalRun{
		EvalID:         event.EvalID,
		PromptID:       event.PromptID,
		StartedAt:      event.StartedAt,
		Models:         models,
		CaseNames:      caseNames,
		TotalCases:     event.TotalCases,
		CompletedCases: []EvalCaseData{},
		Status:         "running",
	}

	s.evalList = append([]*EvalRun{run}, s.evalList...)
	s.evalByID[event.EvalID] = run

	// Evict oldest if over capacity.
	for len(s.evalList) > s.maxEvalRuns {
		evicted := s.evalList[len(s.evalList)-1]
		s.evalList = s.evalList[:len(s.evalList)-1]
		delete(s.evalByID, evicted.EvalID)
	}

	s.mu.Unlock()
	s.notify()
}

// EvalCase adds a completed case to an eval run.
func (s *Store) EvalCase(event EvalCaseEvent) {
	s.mu.Lock()

	run := s.evalByID[event.EvalID]
	if run == nil {
		s.mu.Unlock()
		return
	}

	run.CompletedCases = append(run.CompletedCases, EvalCaseData{
		CaseName:        event.CaseName,
		ModelID:         event.ModelID,
		Passed:          event.Passed,
		DurationMs:      event.DurationMs,
		Error:           event.Error,
		Usage:           event.Usage,
		Cost:            event.Cost,
		TraceID:         event.TraceID,
		Input:           event.Input,
		Output:          event.Output,
		Scores:          event.Scores,
		FailureCategory: event.FailureCategory,
	})

	s.mu.Unlock()
	s.notify()
}

// EvalEnd marks an eval run as completed.
func (s *Store) EvalEnd(event EvalEndEvent) {
	s.mu.Lock()

	run := s.evalByID[event.EvalID]
	if run == nil {
		s.mu.Unlock()
		return
	}

	run.Status = "completed"
	dur := event.DurationMs
	run.DurationMs = &dur
	run.Summary = event.Summary

	s.mu.Unlock()
	s.notify()
}

// RagEvalStart creates a new RAG eval run.
func (s *Store) RagEvalStart(event RagEvalStartEvent) {
	s.mu.Lock()

	configLabels := event.ConfigLabels
	if configLabels == nil {
		configLabels = []string{}
	}

	run := &RagEvalRun{
		EvalID:         event.EvalID,
		SuiteID:        event.SuiteID,
		StartedAt:      event.Timestamp,
		CaseCount:      event.CaseCount,
		ConfigLabels:   configLabels,
		CompletedCases: []RagEvalCaseData{},
		Status:         "running",
	}

	s.ragEvalList = append([]*RagEvalRun{run}, s.ragEvalList...)
	s.ragEvalByID[event.EvalID] = run

	for len(s.ragEvalList) > s.maxEvalRuns {
		evicted := s.ragEvalList[len(s.ragEvalList)-1]
		s.ragEvalList = s.ragEvalList[:len(s.ragEvalList)-1]
		delete(s.ragEvalByID, evicted.EvalID)
	}

	s.mu.Unlock()
	s.notify()
}

// RagEvalCase adds a completed case preview to a RAG eval run.
func (s *Store) RagEvalCase(event RagEvalCaseEvent) {
	s.mu.Lock()

	run := s.ragEvalByID[event.EvalID]
	if run == nil {
		s.mu.Unlock()
		return
	}

	failureTypes := event.FailureTypes
	if failureTypes == nil {
		failureTypes = []string{}
	}

	run.CompletedCases = append(run.CompletedCases, RagEvalCaseData{
		CaseID:       event.CaseID,
		CaseName:     event.CaseName,
		Status:       event.Status,
		ConfigRole:   event.ConfigRole,
		ConfigLabel:  event.ConfigLabel,
		FailureTypes: failureTypes,
		DurationMs:   event.DurationMs,
		Metrics:      event.Metrics,
		Retrieval:    event.Retrieval,
		Answer:       event.Answer,
		Citations:    event.Citations,
		Trace:        event.Trace,
		Error:        event.Error,
	})

	s.mu.Unlock()
	s.notify()
}

// RagEvalEnd marks a RAG eval run as completed or errored.
func (s *Store) RagEvalEnd(event RagEvalEndEvent) {
	s.mu.Lock()

	run := s.ragEvalByID[event.EvalID]
	if run == nil {
		s.mu.Unlock()
		return
	}

	run.Status = "completed"
	if event.Status == "error" {
		run.Status = "error"
	}
	run.Summary = event.Summary

	s.mu.Unlock()
	s.notify()
}

// GetEvalRuns returns all eval runs in newest-first order.
func (s *Store) GetEvalRuns() []EvalRun {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]EvalRun, len(s.evalList))
	for i, r := range s.evalList {
		out[i] = *r
	}
	return out
}

// GetEvalRun returns a single eval run by ID, or nil if not found.
func (s *Store) GetEvalRun(evalID string) *EvalRun {
	s.mu.RLock()
	defer s.mu.RUnlock()

	r := s.evalByID[evalID]
	if r == nil {
		return nil
	}
	cp := *r
	return &cp
}

// GetRagEvalRuns returns all RAG eval runs in newest-first order.
func (s *Store) GetRagEvalRuns() []RagEvalRun {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]RagEvalRun, len(s.ragEvalList))
	for i, r := range s.ragEvalList {
		out[i] = *r
	}
	return out
}

// GetRagEvalRun returns a single RAG eval run by ID, or nil if not found.
func (s *Store) GetRagEvalRun(evalID string) *RagEvalRun {
	s.mu.RLock()
	defer s.mu.RUnlock()

	r := s.ragEvalByID[evalID]
	if r == nil {
		return nil
	}
	cp := *r
	return &cp
}

// GetEvalBaseline returns the most recent completed eval run for a prompt.
func (s *Store) GetEvalBaseline(promptID string) *EvalRun {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, run := range s.evalList {
		if run.PromptID != nil && *run.PromptID == promptID && run.Status == "completed" {
			cp := *run
			return &cp
		}
	}
	return nil
}

// SetIndex replaces the index with new data.
func (s *Store) SetIndex(prompts []PromptMeta, contexts []ContextMeta, tools []ToolMeta) {
	s.SetIndexData(IndexData{Prompts: prompts, Contexts: contexts, Tools: tools})
}

// SetIndexData replaces the index with the canonical Project Index read model.
func (s *Store) SetIndexData(index IndexData) {
	s.mu.Lock()

	if index.SchemaVersion == 0 {
		index.SchemaVersion = 1
	}
	if index.Prompts == nil {
		index.Prompts = []PromptMeta{}
	}
	if index.Contexts == nil {
		index.Contexts = []ContextMeta{}
	}
	if index.Tools == nil {
		index.Tools = []ToolMeta{}
	}
	if index.Indexing == nil {
		index.Indexing = DefaultIndexIndexingStatus()
	}
	if index.Definitions == nil {
		index.Definitions = []ProjectDefinition{}
	}
	if index.Relations == nil {
		index.Relations = []ProjectRelation{}
	}
	if index.Diagnostics == nil {
		index.Diagnostics = []IndexDiagnostic{}
	}
	if index.Sources == nil {
		index.Sources = []IndexSourceFile{}
	}

	s.index = index

	s.mu.Unlock()
	s.notify()
}

// GetIndex returns the raw current index without derived quality enrichment.
func (s *Store) GetIndex() IndexData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneIndexData(s.index)
}

// Snapshot returns one atomic raw index and run snapshot for read-model enrichment.
func (s *Store) Snapshot() (index IndexData, evals []EvalRun, rags []RagEvalRun, flows []FlowRun) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	index = cloneIndexData(s.index)
	evals = make([]EvalRun, len(s.evalList))
	for i, r := range s.evalList {
		evals[i] = *r
	}
	rags = make([]RagEvalRun, len(s.ragEvalList))
	for i, r := range s.ragEvalList {
		rags[i] = *r
	}
	flows = make([]FlowRun, len(s.flowRunList))
	for i, r := range s.flowRunList {
		flows[i] = *r
	}
	return index, evals, rags, flows
}

func cloneIndexData(index IndexData) IndexData {
	index.Prompts = cloneSlice(index.Prompts)
	index.Contexts = cloneSlice(index.Contexts)
	index.Tools = cloneSlice(index.Tools)
	index.Definitions = cloneSlice(index.Definitions)
	index.Relations = cloneSlice(index.Relations)
	index.Diagnostics = cloneSlice(index.Diagnostics)
	index.LintFindings = cloneSlice(index.LintFindings)
	index.RuleDescriptors = cloneSlice(index.RuleDescriptors)
	index.Sources = cloneSlice(index.Sources)
	return index
}

func cloneSlice[T any](values []T) []T {
	if values == nil {
		return nil
	}
	return append([]T{}, values...)
}
