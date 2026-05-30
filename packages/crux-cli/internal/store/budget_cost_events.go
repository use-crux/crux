package store

// BudgetCheck records a budget:check event.
func (s *Store) BudgetCheck(event BudgetCheckEvent) {
	s.mu.Lock()

	total := event.Used + event.Available
	var usagePercent float64
	if total > 0 {
		usagePercent = float64(event.Used) / float64(total) * 100
	}

	entry := BudgetSnapshotData{
		TraceID:      event.TraceID,
		Timestamp:    event.Timestamp,
		Level:        event.Level,
		UsedTokens:   event.Used,
		BudgetTokens: total,
		UsagePercent: usagePercent,
	}
	s.budgetSnapshots.Push(entry)

	breakdownAny := map[string]any{}
	for k, v := range event.Breakdown {
		breakdownAny[k] = v
	}

	s.correlate(event.TraceID, "budget:check", event.Timestamp, map[string]any{
		"used":      event.Used,
		"available": event.Available,
		"level":     event.Level,
		"breakdown": breakdownAny,
	})

	s.mu.Unlock()
	s.notify()
}

// RecordCostEvent records a cost:report, cost:warn, or cost:limit event.
func (s *Store) RecordCostEvent(kind string, event CostEvent) {
	s.mu.Lock()

	sessionID := ""
	if raw, ok := event.Entry["sessionId"]; ok {
		if v, ok := raw.(string); ok {
			sessionID = v
		}
	}
	entry := CostEventData{
		Kind:      kind,
		TraceID:   event.TraceID,
		SessionID: sessionID,
		Timestamp: event.Timestamp,
		Threshold: event.Threshold,
		Actual:    event.Actual,
		Entry:     event.Entry,
		Report:    event.Report,
	}
	s.costEvents.Push(entry)

	s.correlate(event.TraceID, "cost:"+kind, event.Timestamp, map[string]any{
		"threshold": event.Threshold,
		"actual":    event.Actual,
		"entry":     event.Entry,
	})

	s.mu.Unlock()
	s.notify()
}
