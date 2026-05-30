package store

// BlackboardUpdate records a blackboard:update event and updates the blackboard memory instance.
func (s *Store) BlackboardUpdate(event BlackboardUpdateEvent) {
	s.mu.Lock()

	entry := AgentEventData{
		Kind:      "blackboard",
		TraceID:   event.TraceID,
		Timestamp: event.Timestamp,
		Data:      event.Snapshot,
	}
	s.agentEvents.Push(entry)

	fieldsAny := make([]any, len(event.FieldsChanged))
	for i, f := range event.FieldsChanged {
		fieldsAny[i] = f
	}

	s.correlate(event.TraceID, "blackboard:update", event.Timestamp, map[string]any{
		"boardId":       event.BoardID,
		"fieldsChanged": fieldsAny,
		"snapshot":      event.Snapshot,
	})

	// Update memory instance index for blackboard.
	inst := s.getOrCreateInstance(event.BoardID, "blackboard")
	inst.writeCount++
	if event.Timestamp > inst.lastActivity {
		inst.lastActivity = event.Timestamp
	}
	if event.Snapshot != nil {
		inst.currentState = event.Snapshot
	}

	s.mu.Unlock()
	s.notify()
}

// HandoffPrepare records a handoff:prepare event.
func (s *Store) HandoffPrepare(event HandoffPrepareEvent) {
	s.mu.Lock()

	inputSize := event.InputSize
	outputSize := event.OutputSize
	entry := AgentEventData{
		Kind:       "handoff",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		InputSize:  &inputSize,
		OutputSize: &outputSize,
	}
	s.agentEvents.Push(entry)

	handoffData := map[string]any{
		"handoffId":  event.HandoffID,
		"inputSize":  event.InputSize,
		"outputSize": event.OutputSize,
		"fromAgent":  event.FromAgent,
		"toAgent":    event.ToAgent,
		"summary":    event.Summary,
	}
	if event.SpanID != "" {
		handoffData["spanId"] = event.SpanID
	}
	if event.ParentSpanID != "" {
		handoffData["parentSpanId"] = event.ParentSpanID
	}
	s.correlate(event.TraceID, "handoff:prepare", event.Timestamp, handoffData)

	s.mu.Unlock()
	s.notify()
}

// JudgeResult records a judge:result event.
func (s *Store) JudgeResult(event JudgeResultEvent) {
	s.mu.Lock()

	entry := JudgeEventData{
		TraceID:   event.TraceID,
		Timestamp: event.Timestamp,
		Metric:    event.MetricID,
		Score:     event.Score,
		Reasoning: event.Reasoning,
	}
	s.judgeEvents.Push(entry)

	s.correlate(event.TraceID, "judge:result", event.Timestamp, map[string]any{
		"metricId":  event.MetricID,
		"score":     event.Score,
		"reasoning": event.Reasoning,
	})

	s.mu.Unlock()
	s.notify()
}

// DelegateStart records a delegate:start event.
func (s *Store) DelegateStart(event DelegateStartEvent) {
	s.mu.Lock()

	entry := DelegateEventData{
		Kind:      "start",
		TraceID:   event.TraceID,
		Timestamp: event.Timestamp,
		AgentID:   event.DelegateID,
	}
	s.delegateEvents.Push(entry)

	delegateStartData := map[string]any{
		"delegateId": event.DelegateID,
		"handoffId":  event.HandoffID,
		"inputSize":  event.InputSize,
	}
	if event.SpanID != "" {
		delegateStartData["spanId"] = event.SpanID
	}
	if event.ParentSpanID != "" {
		delegateStartData["parentSpanId"] = event.ParentSpanID
	}
	s.correlate(event.TraceID, "delegate:start", event.Timestamp, delegateStartData)

	s.mu.Unlock()
	s.notify()
}

// DelegateComplete records a delegate:complete event.
func (s *Store) DelegateComplete(event DelegateCompleteEvent) {
	s.mu.Lock()

	dur := event.DurationMs
	entry := DelegateEventData{
		Kind:       "complete",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		AgentID:    event.DelegateID,
		DurationMs: &dur,
	}
	s.delegateEvents.Push(entry)

	delegateCompleteData := map[string]any{
		"delegateId": event.DelegateID,
		"handoffId":  event.HandoffID,
		"inputSize":  event.InputSize,
		"outputSize": event.OutputSize,
		"durationMs": event.DurationMs,
	}
	if event.SpanID != "" {
		delegateCompleteData["spanId"] = event.SpanID
	}
	s.correlate(event.TraceID, "delegate:complete", event.Timestamp, delegateCompleteData)

	s.mu.Unlock()
	s.notify()
}
