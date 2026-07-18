package store

// ----------------------------------------------------------------
// Runtime flow event types.
// ----------------------------------------------------------------

// RuntimeFlowStartEvent is the incoming event for runtime-flow:start.
type RuntimeFlowStartEvent struct {
	FlowID       string `json:"flowId"`
	SessionID    string `json:"sessionId"`
	Name         string `json:"name"`
	Goal         string `json:"goal,omitempty"`
	StartedAt    int64  `json:"startedAt"`
	TraceID      string `json:"traceId,omitempty"`
	ParentFlowID string `json:"parentFlowId,omitempty"`
	SpanID       string `json:"spanId,omitempty"`
	ParentSpanID string `json:"parentSpanId,omitempty"`
}

// RuntimeFlowStepEvent is the incoming event for runtime-flow:step.
type RuntimeFlowStepEvent struct {
	FlowID        string     `json:"flowId"`
	SessionID     string     `json:"sessionId"`
	StepID        string     `json:"stepId"`
	Label         string     `json:"label"`
	Status        string     `json:"status"`
	Timestamp     int64      `json:"timestamp"`
	TraceID       string     `json:"traceId,omitempty"`
	DurationMs    *float64   `json:"durationMs,omitempty"`
	TotalTokens   *int       `json:"totalTokens,omitempty"`
	Cost          *float64   `json:"cost,omitempty"`
	ToolCallNames []string   `json:"toolCallNames,omitempty"`
	Actor         string     `json:"actor,omitempty"`
	FromStepID    string     `json:"fromStepId,omitempty"`
	HandoffKind   string     `json:"handoffKind,omitempty"`
	InputSummary  string     `json:"inputSummary,omitempty"`
	OutputSummary string     `json:"outputSummary,omitempty"`
	Note          string     `json:"note,omitempty"`
	Source        *SourceLoc `json:"source,omitempty"`
}

// RuntimeFlowEndEvent is the incoming event for runtime-flow:end.
type RuntimeFlowEndEvent struct {
	FlowID     string                `json:"flowId"`
	SessionID  string                `json:"sessionId"`
	Status     string                `json:"status"`
	DurationMs float64               `json:"durationMs"`
	Timestamp  int64                 `json:"timestamp"`
	TraceID    string                `json:"traceId,omitempty"`
	Aggregate  *RuntimeFlowAggregate `json:"aggregate,omitempty"`
	Error      string                `json:"error,omitempty"`
	SpanID     string                `json:"spanId,omitempty"`
}

// RuntimeFlowSuspendEvent is the incoming event for runtime-flow:suspend.
type RuntimeFlowSuspendEvent struct {
	FlowID       string `json:"flowId"`
	SessionID    string `json:"sessionId"`
	Name         string `json:"name"`
	SuspendPoint string `json:"suspendPoint"`
	Timestamp    int64  `json:"timestamp"`
	TraceID      string `json:"traceId,omitempty"`
}

// RuntimeFlowResumeEvent is the incoming event for runtime-flow:resume.
type RuntimeFlowResumeEvent struct {
	FlowID    string `json:"flowId"`
	SessionID string `json:"sessionId"`
	Name      string `json:"name"`
	Timestamp int64  `json:"timestamp"`
	TraceID   string `json:"traceId,omitempty"`
}

// RuntimeFlowSignalEvent is the incoming event for runtime-flow:signal.
type RuntimeFlowSignalEvent struct {
	FlowID     string `json:"flowId"`
	SessionID  string `json:"sessionId"`
	SignalName string `json:"signalName"`
	Timestamp  int64  `json:"timestamp"`
	TraceID    string `json:"traceId,omitempty"`
}

// RuntimeFlowCancelEvent is the incoming event for runtime-flow:cancel.
type RuntimeFlowCancelEvent struct {
	FlowID    string `json:"flowId"`
	SessionID string `json:"sessionId"`
	Name      string `json:"name"`
	Reason    string `json:"reason,omitempty"`
	Timestamp int64  `json:"timestamp"`
	TraceID   string `json:"traceId,omitempty"`
}

// RuntimeFlowExpiredEvent is the incoming event for runtime-flow:expired.
type RuntimeFlowExpiredEvent struct {
	FlowID       string `json:"flowId"`
	SessionID    string `json:"sessionId"`
	Name         string `json:"name"`
	SuspendPoint string `json:"suspendPoint"`
	Timestamp    int64  `json:"timestamp"`
	TraceID      string `json:"traceId,omitempty"`
}

// ----------------------------------------------------------------
// Runtime flow methods.
// ----------------------------------------------------------------

// runtimeFlowKey builds the map key for a runtime flow.
func runtimeFlowKey(flowID, sessionID string) string {
	return flowID + ":" + sessionID
}

// addRelatedTraceID appends a traceID to the run's relatedTraceIds if not already present.
func addRelatedTraceID(run *RuntimeFlowRunData, traceID string) {
	if traceID == "" {
		return
	}
	for _, id := range run.RelatedTraceIDs {
		if id == traceID {
			return
		}
	}
	run.RelatedTraceIDs = append(run.RelatedTraceIDs, traceID)
}

// RuntimeFlowStart creates a new runtime flow run.
func (s *Store) RuntimeFlowStart(event RuntimeFlowStartEvent) {
	s.mu.Lock()

	key := runtimeFlowKey(event.FlowID, event.SessionID)

	relatedTraceIDs := []string{}
	if event.TraceID != "" {
		relatedTraceIDs = []string{event.TraceID}
	}

	run := &RuntimeFlowRunData{
		FlowID:          event.FlowID,
		SessionID:       event.SessionID,
		Name:            event.Name,
		Goal:            event.Goal,
		StartedAt:       event.StartedAt,
		TriggerTraceID:  event.TraceID,
		RelatedTraceIDs: relatedTraceIDs,
		Steps:           []RuntimeFlowStepData{},
		Status:          "running",
		ParentFlowID:    event.ParentFlowID,
	}

	s.runtimeFlowList = append([]*RuntimeFlowRunData{run}, s.runtimeFlowList...)
	s.runtimeFlowByKey[key] = run

	// Evict oldest if over capacity.
	for len(s.runtimeFlowList) > s.maxRuntimeFlows {
		evicted := s.runtimeFlowList[len(s.runtimeFlowList)-1]
		s.runtimeFlowList = s.runtimeFlowList[:len(s.runtimeFlowList)-1]
		delete(s.runtimeFlowByKey, runtimeFlowKey(evicted.FlowID, evicted.SessionID))
	}

	flowStartData := map[string]any{
		"flowId":    event.FlowID,
		"sessionId": event.SessionID,
		"name":      event.Name,
		"goal":      event.Goal,
	}
	if event.SpanID != "" {
		flowStartData["spanId"] = event.SpanID
	}
	if event.ParentSpanID != "" {
		flowStartData["parentSpanId"] = event.ParentSpanID
	}
	s.correlate(event.TraceID, "runtime-flow:start", event.StartedAt, flowStartData)

	s.mu.Unlock()
	s.notify()
}

// RuntimeFlowStep updates or adds a step in a runtime flow run.
func (s *Store) RuntimeFlowStep(event RuntimeFlowStepEvent) {
	s.mu.Lock()

	key := runtimeFlowKey(event.FlowID, event.SessionID)
	run := s.runtimeFlowByKey[key]
	if run == nil {
		s.mu.Unlock()
		return
	}

	toolCallNames := event.ToolCallNames
	if toolCallNames == nil {
		toolCallNames = []string{}
	}

	// Check if step already exists (update in place).
	var existing *RuntimeFlowStepData
	for i := range run.Steps {
		if run.Steps[i].StepID == event.StepID {
			existing = &run.Steps[i]
			break
		}
	}

	if existing != nil {
		existing.Label = event.Label
		existing.Status = event.Status
		existing.Timestamp = event.Timestamp
		existing.DurationMs = event.DurationMs
		existing.TotalTokens = event.TotalTokens
		existing.Cost = event.Cost
		existing.ToolCallNames = toolCallNames
		existing.Actor = event.Actor
		existing.FromStepID = event.FromStepID
		existing.HandoffKind = event.HandoffKind
		existing.InputSummary = event.InputSummary
		existing.OutputSummary = event.OutputSummary
		existing.TraceID = event.TraceID
		existing.Note = event.Note
		if event.Source != nil {
			existing.Source = event.Source
		}
	} else {
		run.Steps = append(run.Steps, RuntimeFlowStepData{
			StepID:        event.StepID,
			Label:         event.Label,
			Status:        event.Status,
			Timestamp:     event.Timestamp,
			DurationMs:    event.DurationMs,
			TotalTokens:   event.TotalTokens,
			Cost:          event.Cost,
			ToolCallNames: toolCallNames,
			Actor:         event.Actor,
			FromStepID:    event.FromStepID,
			HandoffKind:   event.HandoffKind,
			InputSummary:  event.InputSummary,
			OutputSummary: event.OutputSummary,
			TraceID:       event.TraceID,
			Note:          event.Note,
			Source:        event.Source,
		})
	}

	addRelatedTraceID(run, event.TraceID)

	s.correlate(event.TraceID, "runtime-flow:step", event.Timestamp, map[string]any{
		"flowId":        event.FlowID,
		"sessionId":     event.SessionID,
		"stepId":        event.StepID,
		"label":         event.Label,
		"status":        event.Status,
		"durationMs":    event.DurationMs,
		"totalTokens":   event.TotalTokens,
		"cost":          event.Cost,
		"actor":         event.Actor,
		"fromStepId":    event.FromStepID,
		"handoffKind":   event.HandoffKind,
		"inputSummary":  event.InputSummary,
		"outputSummary": event.OutputSummary,
	})

	s.mu.Unlock()
	s.notify()
}

// RuntimeFlowEnd marks a runtime flow as completed/failed/etc.
func (s *Store) RuntimeFlowEnd(event RuntimeFlowEndEvent) {
	s.mu.Lock()

	key := runtimeFlowKey(event.FlowID, event.SessionID)
	run := s.runtimeFlowByKey[key]
	if run == nil {
		s.mu.Unlock()
		return
	}

	run.Status = event.Status
	dur := event.DurationMs
	run.DurationMs = &dur
	run.FinishedAt = &event.Timestamp
	run.Aggregate = event.Aggregate
	run.Error = event.Error

	addRelatedTraceID(run, event.TraceID)

	correlateData := map[string]any{
		"flowId":     event.FlowID,
		"sessionId":  event.SessionID,
		"status":     event.Status,
		"durationMs": event.DurationMs,
		"error":      event.Error,
	}
	if event.Aggregate != nil {
		correlateData["totalSteps"] = event.Aggregate.TotalSteps
		correlateData["totalTokens"] = event.Aggregate.TotalTokens
		correlateData["totalCost"] = event.Aggregate.TotalCost
	}
	if event.SpanID != "" {
		correlateData["spanId"] = event.SpanID
	}

	s.correlate(event.TraceID, "runtime-flow:end", event.Timestamp, correlateData)

	s.mu.Unlock()
	s.notify()
}

// RuntimeFlowSuspend marks a runtime flow as suspended.
func (s *Store) RuntimeFlowSuspend(event RuntimeFlowSuspendEvent) {
	s.mu.Lock()

	key := runtimeFlowKey(event.FlowID, event.SessionID)
	run := s.runtimeFlowByKey[key]
	if run == nil {
		s.mu.Unlock()
		return
	}

	run.Status = "suspended"
	run.SuspendedAt = event.SuspendPoint

	addRelatedTraceID(run, event.TraceID)

	s.correlate(event.TraceID, "runtime-flow:suspend", event.Timestamp, map[string]any{
		"flowId":       event.FlowID,
		"sessionId":    event.SessionID,
		"name":         event.Name,
		"suspendPoint": event.SuspendPoint,
	})

	s.mu.Unlock()
	s.notify()
}

// RuntimeFlowResume marks a runtime flow as running again after suspension.
func (s *Store) RuntimeFlowResume(event RuntimeFlowResumeEvent) {
	s.mu.Lock()

	key := runtimeFlowKey(event.FlowID, event.SessionID)
	run := s.runtimeFlowByKey[key]
	if run == nil {
		s.mu.Unlock()
		return
	}

	run.Status = "running"
	run.SuspendedAt = ""

	addRelatedTraceID(run, event.TraceID)

	s.correlate(event.TraceID, "runtime-flow:resume", event.Timestamp, map[string]any{
		"flowId":    event.FlowID,
		"sessionId": event.SessionID,
		"name":      event.Name,
	})

	s.mu.Unlock()
	s.notify()
}

// RuntimeFlowSignal records a signal delivered to a suspended flow.
func (s *Store) RuntimeFlowSignal(event RuntimeFlowSignalEvent) {
	s.mu.Lock()

	key := runtimeFlowKey(event.FlowID, event.SessionID)
	run := s.runtimeFlowByKey[key]
	if run == nil {
		s.mu.Unlock()
		return
	}

	addRelatedTraceID(run, event.TraceID)

	s.correlate(event.TraceID, "runtime-flow:signal", event.Timestamp, map[string]any{
		"flowId":     event.FlowID,
		"sessionId":  event.SessionID,
		"signalName": event.SignalName,
	})

	s.mu.Unlock()
	s.notify()
}

// RuntimeFlowCancel marks a runtime flow as cancelled.
func (s *Store) RuntimeFlowCancel(event RuntimeFlowCancelEvent) {
	s.mu.Lock()

	key := runtimeFlowKey(event.FlowID, event.SessionID)
	run := s.runtimeFlowByKey[key]
	if run == nil {
		s.mu.Unlock()
		return
	}

	run.Status = "cancelled"
	run.CancelReason = event.Reason

	addRelatedTraceID(run, event.TraceID)

	s.correlate(event.TraceID, "runtime-flow:cancel", event.Timestamp, map[string]any{
		"flowId":    event.FlowID,
		"sessionId": event.SessionID,
		"name":      event.Name,
		"reason":    event.Reason,
	})

	s.mu.Unlock()
	s.notify()
}

// RuntimeFlowExpired marks a runtime flow as expired.
func (s *Store) RuntimeFlowExpired(event RuntimeFlowExpiredEvent) {
	s.mu.Lock()

	key := runtimeFlowKey(event.FlowID, event.SessionID)
	run := s.runtimeFlowByKey[key]
	if run == nil {
		s.mu.Unlock()
		return
	}

	run.Status = "expired"

	addRelatedTraceID(run, event.TraceID)

	s.correlate(event.TraceID, "runtime-flow:expired", event.Timestamp, map[string]any{
		"flowId":       event.FlowID,
		"sessionId":    event.SessionID,
		"name":         event.Name,
		"suspendPoint": event.SuspendPoint,
	})

	s.mu.Unlock()
	s.notify()
}

// GetRuntimeFlowRuns returns all runtime flow runs in newest-first order.
func (s *Store) GetRuntimeFlowRuns() []RuntimeFlowRunData {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]RuntimeFlowRunData, len(s.runtimeFlowList))
	for i, r := range s.runtimeFlowList {
		out[i] = *r
	}
	return out
}

// GetRuntimeFlowRun returns a single runtime flow run by flowID+sessionID, or nil if not found.
func (s *Store) GetRuntimeFlowRun(flowID, sessionID string) *RuntimeFlowRunData {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := runtimeFlowKey(flowID, sessionID)
	r := s.runtimeFlowByKey[key]
	if r == nil {
		return nil
	}
	cp := *r
	return &cp
}
