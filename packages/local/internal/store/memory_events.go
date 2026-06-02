package store

import (
	"encoding/json"
)

// MemoryRead records a memory read event and updates the memory instance index.
func (s *Store) MemoryRead(event MemoryReadEvent) {
	s.mu.Lock()

	count := event.ResultCount
	durationMs := event.DurationMs
	entry := MemoryEventData{
		Kind:          "read",
		SpanID:        event.SpanID,
		RunID:         event.RunID,
		MemoryID:      event.MemoryID,
		MemoryType:    event.MemoryType,
		Operation:     event.Operation,
		BlockID:       event.BlockID,
		BlockKind:     event.BlockKind,
		NamespaceHash: event.NamespaceHash,
		Metadata:      event.Metadata,
		TraceID:       event.TraceID,
		Timestamp:     event.Timestamp,
		Query:         event.Query,
		Count:         &count,
		Score:         event.Score,
		DurationMs:    &durationMs,
		Snapshot:      event.Snapshot,
	}
	s.memoryEvents.Push(entry)

	s.correlate(event.TraceID, "memory:read", event.Timestamp, map[string]any{
		"memoryId":    event.MemoryID,
		"operation":   event.Operation,
		"resultCount": event.ResultCount,
		"query":       event.Query,
		"durationMs":  event.DurationMs,
		"memoryType":  event.MemoryType,
	})

	// Update memory instance index.
	if event.MemoryType != "" {
		inst := s.getOrCreateInstance(event.MemoryID, event.MemoryType)
		inst.blockID = firstNonEmpty(inst.blockID, event.BlockID)
		inst.blockKind = firstNonEmpty(inst.blockKind, event.BlockKind)
		inst.namespaceHash = firstNonEmpty(inst.namespaceHash, event.NamespaceHash)
		inst.readCount++
		if event.Timestamp > inst.lastActivity {
			inst.lastActivity = event.Timestamp
		}

		if len(event.Snapshot) > 0 && string(event.Snapshot) != "null" {
			if event.MemoryType == "working" || (event.MemoryType == "block" && event.BlockKind == "working") {
				// Working memory stores the full state.
				var state any
				if err := json.Unmarshal(event.Snapshot, &state); err == nil {
					inst.currentState = state
				}
			} else {
				// Other types: snapshot is an array of entries — replace all.
				var entries []MemoryEntryData
				if err := json.Unmarshal(event.Snapshot, &entries); err == nil {
					inst.entries = make(map[string]MemoryEntryData)
					for _, e := range entries {
						if e.Key != "" {
							inst.entries[e.Key] = e
						}
					}
				}
			}
		}
	}

	s.mu.Unlock()
	s.notify()
}

// MemoryWrite records a memory write event and updates the memory instance index.
func (s *Store) MemoryWrite(event MemoryWriteEvent) {
	s.mu.Lock()

	entry := MemoryEventData{
		Kind:           "write",
		SpanID:         event.SpanID,
		RunID:          event.RunID,
		MemoryID:       event.MemoryID,
		MemoryType:     event.MemoryType,
		Operation:      event.Operation,
		BlockID:        event.BlockID,
		BlockKind:      event.BlockKind,
		NamespaceHash:  event.NamespaceHash,
		WriteMode:      event.WriteMode,
		ProposalStatus: event.ProposalStatus,
		Metadata:       event.Metadata,
		TraceID:        event.TraceID,
		Timestamp:      event.Timestamp,
		Key:            event.EntryKey,
		Content:        event.Content,
		Snapshot:       event.Snapshot,
	}
	s.memoryEvents.Push(entry)

	s.correlate(event.TraceID, "memory:write", event.Timestamp, map[string]any{
		"memoryId":   event.MemoryID,
		"operation":  event.Operation,
		"entryKey":   event.EntryKey,
		"memoryType": event.MemoryType,
	})

	// Update memory instance index.
	if event.MemoryType != "" {
		inst := s.getOrCreateInstance(event.MemoryID, event.MemoryType)
		inst.blockID = firstNonEmpty(inst.blockID, event.BlockID)
		inst.blockKind = firstNonEmpty(inst.blockKind, event.BlockKind)
		inst.namespaceHash = firstNonEmpty(inst.namespaceHash, event.NamespaceHash)
		inst.writeCount++
		if event.Timestamp > inst.lastActivity {
			inst.lastActivity = event.Timestamp
		}

		if event.MemoryType == "working" || (event.MemoryType == "block" && event.BlockKind == "working") {
			// Working memory: store snapshot as current state.
			if len(event.Snapshot) > 0 && string(event.Snapshot) != "null" {
				var state any
				if err := json.Unmarshal(event.Snapshot, &state); err == nil {
					inst.currentState = state
				}
			} else {
				inst.currentState = nil
			}
		} else if event.Operation == "delete" && event.EntryKey != "" {
			delete(inst.entries, event.EntryKey)
		} else if event.Operation == "clear" || event.Operation == "prune" {
			inst.entries = make(map[string]MemoryEntryData)
		} else if len(event.Snapshot) > 0 && string(event.Snapshot) != "null" {
			// Try to parse as a single entry with a key field.
			var snap MemoryEntryData
			if err := json.Unmarshal(event.Snapshot, &snap); err == nil && snap.Key != "" {
				inst.entries[snap.Key] = snap
			}
		}
	}

	s.mu.Unlock()
	s.notify()
}

// getOrCreateInstance returns the memoryInstance for the given ID, creating it if absent.
// Must be called while holding the write lock.
func (s *Store) getOrCreateInstance(memoryID, memoryType string) *memoryInstance {
	inst := s.memoryInstances[memoryID]
	if inst == nil {
		inst = &memoryInstance{
			memoryID:   memoryID,
			memoryType: memoryType,
			entries:    make(map[string]MemoryEntryData),
		}
		s.memoryInstances[memoryID] = inst
	}
	return inst
}

func firstNonEmpty(current, next string) string {
	if current != "" {
		return current
	}
	return next
}

// CompactStart records a compact:start event.
func (s *Store) CompactStart(event CompactStartEvent) {
	s.mu.Lock()

	inputTokens := event.InputTokens
	msgCount := event.InputMessageCount
	entry := CompactEventData{
		Kind:           "start",
		TraceID:        event.TraceID,
		Timestamp:      event.Timestamp,
		Strategy:       event.Reason,
		InputTokens:    &inputTokens,
		MessagesBefore: &msgCount,
	}
	s.compactEvents.Push(entry)

	s.correlate(event.TraceID, "compact:start", event.Timestamp, map[string]any{
		"reason":            event.Reason,
		"inputMessageCount": event.InputMessageCount,
		"inputTokens":       event.InputTokens,
	})

	s.mu.Unlock()
	s.notify()
}

// CompactEnd records a compact:end event.
func (s *Store) CompactEnd(event CompactEndEvent) {
	s.mu.Lock()

	dur := event.DurationMs
	outputTokens := event.OutputTokens
	entry := CompactEventData{
		Kind:         "end",
		TraceID:      event.TraceID,
		Timestamp:    event.Timestamp,
		OutputTokens: &outputTokens,
		DurationMs:   &dur,
	}
	s.compactEvents.Push(entry)

	s.correlate(event.TraceID, "compact:end", event.Timestamp, map[string]any{
		"outputTokens":     event.OutputTokens,
		"compressionRatio": event.CompressionRatio,
		"durationMs":       event.DurationMs,
	})

	s.mu.Unlock()
	s.notify()
}
