package store

type ValidationRetryAttemptEvent struct {
	RetryID         string `json:"retryId"`
	AttemptNumber   int    `json:"attemptNumber"`
	MaxAttempts     int    `json:"maxAttempts"`
	Error           string `json:"error"`
	RawOutput       string `json:"rawOutput"`
	RepairAttempted bool   `json:"repairAttempted"`
	RepairSucceeded bool   `json:"repairSucceeded"`
	TraceID         string `json:"traceId,omitempty"`
	Timestamp       int64  `json:"timestamp"`
}

// ValidationRetryExhaustedEvent is the incoming event for validation-retry:exhausted.
type ValidationRetryExhaustedEvent struct {
	RetryID       string `json:"retryId"`
	TotalAttempts int    `json:"totalAttempts"`
	LastError     string `json:"lastError"`
	PromptID      string `json:"promptId"`
	TraceID       string `json:"traceId,omitempty"`
	Timestamp     int64  `json:"timestamp"`
}

// ValidationRetryAttempt handles an incoming validation-retry:attempt event.
func (s *Store) ValidationRetryAttempt(event ValidationRetryAttemptEvent) {
	s.mutate(func() {
		s.correlate(event.TraceID, "validation-retry:attempt", event.Timestamp, map[string]any{
			"retryId":         event.RetryID,
			"attemptNumber":   event.AttemptNumber,
			"maxAttempts":     event.MaxAttempts,
			"error":           event.Error,
			"repairAttempted": event.RepairAttempted,
			"repairSucceeded": event.RepairSucceeded,
		})
	})
}

// ValidationRetryExhausted handles an incoming validation-retry:exhausted event.
func (s *Store) ValidationRetryExhausted(event ValidationRetryExhaustedEvent) {
	s.mutate(func() {
		s.correlate(event.TraceID, "validation-retry:exhausted", event.Timestamp, map[string]any{
			"retryId":       event.RetryID,
			"totalAttempts": event.TotalAttempts,
			"lastError":     event.LastError,
			"promptId":      event.PromptID,
		})
	})
}

// ----------------------------------------------------------------
// Routing event types.
// ----------------------------------------------------------------

// RouterSelectEvent is the incoming event for router:select.
type RouterSelectEvent struct {
	ClassifiedAs    string                 `json:"classifiedAs"`
	SelectedModel   string                 `json:"selectedModel"`
	AvailableRoutes []string               `json:"availableRoutes"`
	Hints           map[string]interface{} `json:"hints,omitempty"`
	Overridden      bool                   `json:"overridden"`
	TraceID         string                 `json:"traceId,omitempty"`
	Timestamp       int64                  `json:"timestamp"`
}

// CascadeTierEvent is the incoming event for cascade:tier.
type CascadeTierEvent struct {
	TierIndex  int     `json:"tierIndex"`
	Model      string  `json:"model"`
	Status     string  `json:"status"`
	DurationMs float64 `json:"durationMs"`
	Cost       float64 `json:"cost,omitempty"`
	TraceID    string  `json:"traceId,omitempty"`
	Timestamp  int64   `json:"timestamp"`
}

// CascadeCompleteEvent is the incoming event for cascade:complete.
type CascadeCompleteEvent struct {
	AcceptedTier    int     `json:"acceptedTier"`
	TotalTiers      int     `json:"totalTiers"`
	TotalCost       float64 `json:"totalCost"`
	TotalDurationMs float64 `json:"totalDurationMs"`
	BudgetExceeded  bool    `json:"budgetExceeded"`
	TraceID         string  `json:"traceId,omitempty"`
	Timestamp       int64   `json:"timestamp"`
}

// BudgetExceededEvent is the incoming event for budget:exceeded.
type BudgetExceededEvent struct {
	BudgetType string  `json:"budgetType"`
	Limit      float64 `json:"limit"`
	Actual     float64 `json:"actual"`
	TraceID    string  `json:"traceId,omitempty"`
	Timestamp  int64   `json:"timestamp"`
}

// RouterSelect handles an incoming router:select event.
func (s *Store) RouterSelect(event RouterSelectEvent) {
	s.mutate(func() {
		s.correlate(event.TraceID, "router:select", event.Timestamp, map[string]any{
			"classifiedAs":    event.ClassifiedAs,
			"selectedModel":   event.SelectedModel,
			"availableRoutes": event.AvailableRoutes,
			"overridden":      event.Overridden,
		})
	})
}

// CascadeTier handles an incoming cascade:tier event.
func (s *Store) CascadeTier(event CascadeTierEvent) {
	s.mutate(func() {
		s.correlate(event.TraceID, "cascade:tier", event.Timestamp, map[string]any{
			"tierIndex":  event.TierIndex,
			"model":      event.Model,
			"status":     event.Status,
			"durationMs": event.DurationMs,
			"cost":       event.Cost,
		})
	})
}

// CascadeComplete handles an incoming cascade:complete event.
func (s *Store) CascadeComplete(event CascadeCompleteEvent) {
	s.mutate(func() {
		s.correlate(event.TraceID, "cascade:complete", event.Timestamp, map[string]any{
			"acceptedTier":    event.AcceptedTier,
			"totalTiers":      event.TotalTiers,
			"totalCost":       event.TotalCost,
			"totalDurationMs": event.TotalDurationMs,
			"budgetExceeded":  event.BudgetExceeded,
		})
	})
}

// BudgetExceeded handles an incoming budget:exceeded event.
func (s *Store) BudgetExceeded(event BudgetExceededEvent) {
	s.mutate(func() {
		s.correlate(event.TraceID, "budget:exceeded", event.Timestamp, map[string]any{
			"budgetType": event.BudgetType,
			"limit":      event.Limit,
			"actual":     event.Actual,
		})
	})
}

// ----------------------------------------------------------------
// Guardrail event types.
// ----------------------------------------------------------------

// AddGuardrailRun records a guardrail:run event.
func (s *Store) AddGuardrailRun(event GuardrailRunEvent) {
	s.mutate(func() {
		s.guardrailRuns.Push(event)
		s.correlate(event.TraceID, "guardrail:run", event.Timestamp, map[string]any{
			"guardrailId": event.GuardrailID,
			"phase":       event.Phase,
			"action":      event.Action,
			"reason":      event.Reason,
			"durationMs":  event.DurationMs,
		})
	})
}

// GetGuardrailRuns returns all guardrail run events.
func (s *Store) GetGuardrailRuns() []GuardrailRunEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.guardrailRuns)
}

// ----------------------------------------------------------------
// Constraint event types.
// ----------------------------------------------------------------

// AddConstraintEvent records a constraint:check event.
func (s *Store) AddConstraintEvent(event ConstraintCheckEvent) {
	s.mutate(func() {
		s.constraintChecks.Push(event)
		s.correlate(event.TraceID, "constraint:check", event.Timestamp, map[string]any{
			"constraintName": event.ConstraintName,
			"severity":       event.Severity,
			"pass":           event.Pass,
			"feedback":       event.Feedback,
			"durationMs":     event.DurationMs,
			"attempt":        event.Attempt,
		})
	})
}

// AddConstraintRetry records a constraint:retry event.
func (s *Store) AddConstraintRetry(event ConstraintRetryEvent) {
	s.mutate(func() {
		s.constraintRetries.Push(event)
		s.correlate(event.TraceID, "constraint:retry", event.Timestamp, map[string]any{
			"constraintNames":  event.ConstraintNames,
			"attempt":          event.Attempt,
			"combinedFeedback": event.CombinedFeedback,
		})
	})
}

// AddConstraintViolation records a constraint:violation event.
func (s *Store) AddConstraintViolation(event ConstraintViolationEvent) {
	s.mutate(func() {
		s.constraintViolations.Push(event)
		s.correlate(event.TraceID, "constraint:violation", event.Timestamp, map[string]any{
			"constraintNames": event.ConstraintNames,
			"totalAttempts":   event.TotalAttempts,
		})
	})
}

// GetConstraintChecks returns all constraint check events.
func (s *Store) GetConstraintChecks() []ConstraintCheckEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.constraintChecks)
}

// GetConstraintRetries returns all constraint retry events.
func (s *Store) GetConstraintRetries() []ConstraintRetryEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.constraintRetries)
}

// GetConstraintViolations returns all constraint violation events.
func (s *Store) GetConstraintViolations() []ConstraintViolationEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.constraintViolations)
}

// convertMemoryInstance converts the internal memoryInstance to the public MemoryInstanceData.
func convertMemoryInstance(inst *memoryInstance) MemoryInstanceData {
	entries := make([]MemoryEntryData, 0, len(inst.entries))
	for _, e := range inst.entries {
		entries = append(entries, e)
	}

	return MemoryInstanceData{
		MemoryID:      inst.memoryID,
		MemoryType:    inst.memoryType,
		BlockID:       inst.blockID,
		BlockKind:     inst.blockKind,
		NamespaceHash: inst.namespaceHash,
		ReadCount:     inst.readCount,
		WriteCount:    inst.writeCount,
		LastActivity:  inst.lastActivity,
		CurrentState:  inst.currentState,
		Entries:       entries,
	}
}
