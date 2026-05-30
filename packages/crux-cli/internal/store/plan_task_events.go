package store

// PlanCreated records a plan:created event.
func (s *Store) PlanCreated(event PlanCreatedEvent) {
	s.mu.Lock()

	entry := PlanEventData{
		Kind:      "created",
		TraceID:   event.TraceID,
		Timestamp: event.Timestamp,
		PlanID:    event.PlanID,
		Data: map[string]any{
			"title":  event.Title,
			"status": event.Status,
		},
	}
	s.planEvents.Push(entry)

	s.correlate(event.TraceID, "plan:created", event.Timestamp, map[string]any{
		"planId": event.PlanID,
		"title":  event.Title,
		"status": event.Status,
	})

	s.mu.Unlock()
	s.notify()
}

// PlanUpdated records a plan:updated event.
func (s *Store) PlanUpdated(event PlanUpdatedEvent) {
	s.mu.Lock()

	changesAny := make([]any, len(event.Changes))
	for i, c := range event.Changes {
		changesAny[i] = c
	}

	entry := PlanEventData{
		Kind:      "updated",
		TraceID:   event.TraceID,
		Timestamp: event.Timestamp,
		PlanID:    event.PlanID,
		Data: map[string]any{
			"version": event.Version,
			"changes": changesAny,
		},
	}
	s.planEvents.Push(entry)

	s.correlate(event.TraceID, "plan:updated", event.Timestamp, map[string]any{
		"planId":  event.PlanID,
		"version": event.Version,
		"changes": changesAny,
	})

	s.mu.Unlock()
	s.notify()
}

// TaskListCreated records a tasklist:created event.
func (s *Store) TaskListCreated(event TaskListCreatedEvent) {
	s.mu.Lock()

	entry := TaskListEventData{
		Kind:       "created",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		TaskListID: event.TaskListID,
		Data: map[string]any{
			"planId": event.PlanID,
		},
	}
	s.taskListEvents.Push(entry)

	s.correlate(event.TraceID, "tasklist:created", event.Timestamp, map[string]any{
		"taskListId": event.TaskListID,
		"planId":     event.PlanID,
	})

	s.mu.Unlock()
	s.notify()
}

// TaskListCompleted records a tasklist:completed event.
func (s *Store) TaskListCompleted(event TaskListCompletedEvent) {
	s.mu.Lock()

	entry := TaskListEventData{
		Kind:       "completed",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		TaskListID: event.TaskListID,
		Data: map[string]any{
			"totalTasks": event.TotalTasks,
			"durationMs": event.DurationMs,
		},
	}
	s.taskListEvents.Push(entry)

	s.correlate(event.TraceID, "tasklist:completed", event.Timestamp, map[string]any{
		"taskListId": event.TaskListID,
		"totalTasks": event.TotalTasks,
		"durationMs": event.DurationMs,
	})

	s.mu.Unlock()
	s.notify()
}

// TaskListDiscarded records a tasklist:discarded event.
func (s *Store) TaskListDiscarded(event TaskListDiscardedEvent) {
	s.mu.Lock()

	entry := TaskListEventData{
		Kind:       "discarded",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		TaskListID: event.TaskListID,
		Data: map[string]any{
			"reason":         event.Reason,
			"completedCount": event.CompletedCount,
			"remainingCount": event.RemainingCount,
		},
	}
	s.taskListEvents.Push(entry)

	s.correlate(event.TraceID, "tasklist:discarded", event.Timestamp, map[string]any{
		"taskListId":     event.TaskListID,
		"reason":         event.Reason,
		"completedCount": event.CompletedCount,
		"remainingCount": event.RemainingCount,
	})

	s.mu.Unlock()
	s.notify()
}

// TaskAdded records a task:added event.
func (s *Store) TaskAdded(event TaskAddedEvent) {
	s.mu.Lock()

	entry := TaskEventData{
		Kind:       "added",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		TaskListID: event.TaskListID,
		TaskID:     event.TaskID,
		Data: map[string]any{
			"label":    event.Label,
			"assignee": event.Assignee,
		},
	}
	s.taskEvents.Push(entry)

	s.correlate(event.TraceID, "task:added", event.Timestamp, map[string]any{
		"taskListId": event.TaskListID,
		"taskId":     event.TaskID,
		"label":      event.Label,
		"assignee":   event.Assignee,
	})

	s.mu.Unlock()
	s.notify()
}

// TaskUpdated records a task:updated event.
func (s *Store) TaskUpdated(event TaskUpdatedEvent) {
	s.mu.Lock()

	entry := TaskEventData{
		Kind:       "updated",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		TaskListID: event.TaskListID,
		TaskID:     event.TaskID,
		Data: map[string]any{
			"status":     event.Status,
			"progress":   event.Progress,
			"durationMs": event.DurationMs,
		},
	}
	s.taskEvents.Push(entry)

	s.correlate(event.TraceID, "task:updated", event.Timestamp, map[string]any{
		"taskListId": event.TaskListID,
		"taskId":     event.TaskID,
		"status":     event.Status,
		"progress":   event.Progress,
		"durationMs": event.DurationMs,
	})

	s.mu.Unlock()
	s.notify()
}

// TaskRemoved records a task:removed event.
func (s *Store) TaskRemoved(event TaskRemovedEvent) {
	s.mu.Lock()

	entry := TaskEventData{
		Kind:       "removed",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		TaskListID: event.TaskListID,
		TaskID:     event.TaskID,
	}
	s.taskEvents.Push(entry)

	s.correlate(event.TraceID, "task:removed", event.Timestamp, map[string]any{
		"taskListId": event.TaskListID,
		"taskId":     event.TaskID,
	})

	s.mu.Unlock()
	s.notify()
}
