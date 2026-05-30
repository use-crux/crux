package store

// ToolStart records a tool:start event.
func (s *Store) ToolStart(event ToolStartEvent) {
	s.mutate(func() {
		s.toolEvents.Push(toolStartData(event))

		toolStartData := map[string]any{
			"toolCallId": event.ToolCallID,
			"toolName":   event.ToolName,
		}
		if event.SpanID != "" {
			toolStartData["spanId"] = event.SpanID
		}
		if event.ParentSpanID != "" {
			toolStartData["parentSpanId"] = event.ParentSpanID
		}
		s.correlate(event.TraceID, "tool:start", event.Timestamp, toolStartData)
	})
}

// ToolEnd records a tool:end event.
func (s *Store) ToolEnd(event ToolEndEvent) {
	s.mutate(func() {
		s.toolEvents.Push(toolEndData(event))

		data := map[string]any{
			"toolCallId": event.ToolCallID,
			"toolName":   event.ToolName,
			"durationMs": event.DurationMs,
			"error":      event.Error,
		}
		if len(event.Result) > 0 {
			data["result"] = event.Result
		}
		if len(event.ModelOutput) > 0 {
			data["modelOutput"] = event.ModelOutput
		}
		if event.ModelOutputType != "" {
			data["modelOutputType"] = event.ModelOutputType
		}
		if event.OutputSize != nil {
			data["outputSize"] = *event.OutputSize
		}
		if event.ModelOutputSize != nil {
			data["modelOutputSize"] = *event.ModelOutputSize
		}
		if event.TokenSavingsEstimate != nil {
			data["tokenSavingsEstimate"] = *event.TokenSavingsEstimate
		}
		if event.ModelOutputError != "" {
			data["modelOutputError"] = event.ModelOutputError
		}
		if event.SpanID != "" {
			data["spanId"] = event.SpanID
		}
		s.correlate(event.TraceID, "tool:end", event.Timestamp, data)
	})
}

// ToolApprovalRequest records a tool:approval:request event.
func (s *Store) ToolApprovalRequest(event ToolApprovalRequestEvent) {
	s.mutate(func() {
		s.toolEvents.Push(toolApprovalRequestData(event))

		s.correlate(event.TraceID, "tool:approval:request", event.Timestamp, map[string]any{
			"approvalId": event.ApprovalID,
			"toolCallId": event.ToolCallID,
			"toolName":   event.ToolName,
		})
	})
}

// ToolApprovalDecision records a tool:approval:decision event.
func (s *Store) ToolApprovalDecision(event ToolApprovalDecisionEvent) {
	s.mutate(func() {
		s.toolEvents.Push(toolApprovalDecisionData(event))

		s.correlate(event.TraceID, "tool:approval:decision", event.Timestamp, map[string]any{
			"approvalId": event.ApprovalID,
			"toolCallId": event.ToolCallID,
			"toolName":   event.ToolName,
			"approved":   event.Approved,
			"reason":     event.Reason,
		})
	})
}

// SecurityWarning records a security:warning event.
func (s *Store) SecurityWarning(event SecurityWarningEvent) {
	s.mu.Lock()

	entry := SecurityEventData{
		TraceID:   event.TraceID,
		SessionID: event.SessionID,
		Timestamp: event.Timestamp,
		PromptID:  event.PromptID,
		Pattern:   event.Pattern,
		Severity:  "warning",
		Message:   event.Message,
	}
	s.securityEvents.Push(entry)

	s.correlate(event.TraceID, "security:warning", event.Timestamp, map[string]any{
		"promptId":     event.PromptID,
		"field":        event.Field,
		"pattern":      event.Pattern,
		"message":      event.Message,
		"inputPreview": event.InputPreview,
	})

	s.mu.Unlock()
	s.notify()
}

// CompositionStart records a composition:start event.
func (s *Store) CompositionStart(event CompositionStartEvent) {
	s.mutate(func() {
		s.compositionEvents.Push(compositionStartData(event))

		agentIDs := make([]any, len(event.AgentIDs))
		for i, id := range event.AgentIDs {
			agentIDs[i] = id
		}

		s.correlate(event.TraceID, "composition:start", event.Timestamp, map[string]any{
			"compositionId": event.CompositionID,
			"kind":          event.Kind,
			"agentIds":      agentIDs,
		})
	})
}

// CompositionAgent records a composition:agent event.
func (s *Store) CompositionAgent(event CompositionAgentEvent) {
	s.mutate(func() {
		s.compositionEvents.Push(compositionAgentData(event))

		s.correlate(event.TraceID, "composition:agent", event.Timestamp, map[string]any{
			"compositionId": event.CompositionID,
			"agentId":       event.AgentID,
			"status":        event.Status,
			"durationMs":    event.DurationMs,
		})
	})
}

// CompositionEnd records a composition:end event.
func (s *Store) CompositionEnd(event CompositionEndEvent) {
	s.mutate(func() {
		s.compositionEvents.Push(compositionEndData(event))

		correlateData := map[string]any{
			"compositionId": event.CompositionID,
			"kind":          event.Kind,
			"status":        event.Status,
			"durationMs":    event.DurationMs,
			"agentCount":    event.AgentCount,
		}
		if event.Agreement != nil {
			correlateData["agreement"] = *event.Agreement
		}

		s.correlate(event.TraceID, "composition:end", event.Timestamp, correlateData)
	})
}
