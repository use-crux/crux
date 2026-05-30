package store

// WorkspaceOperation records a workspace:operation event.
func (s *Store) WorkspaceOperation(event WorkspaceOperationEvent) {
	s.mu.Lock()

	entry := WorkspaceEventData{
		TraceID:     event.TraceID,
		SessionID:   event.SessionID,
		Timestamp:   event.Timestamp,
		WorkspaceID: event.WorkspaceID,
		Namespace:   event.Namespace,
		Operation:   event.Operation,
		Path:        event.Path,
		Status:      event.Status,
		DurationMs:  event.DurationMs,
		Mount:       event.Mount,
		MimeType:    event.MimeType,
		Size:        event.Size,
	}
	if event.Error != "" {
		entry.Error = &event.Error
	}
	s.workspaceEvents.Push(entry)

	s.correlate(event.TraceID, "workspace:operation", event.Timestamp, map[string]any{
		"workspaceId": event.WorkspaceID,
		"operation":   event.Operation,
		"path":        event.Path,
		"status":      event.Status,
		"durationMs":  event.DurationMs,
		"mimeType":    event.MimeType,
		"size":        event.Size,
		"error":       event.Error,
	})

	s.mu.Unlock()
	s.notify()
}

// IndexStart records an index:start event.
func (s *Store) IndexStart(event IndexStartEvent) {
	s.mu.Lock()

	entry := IndexEventData{
		Kind:           "start",
		TraceID:        event.TraceID,
		Timestamp:      event.Timestamp,
		IndexID:        event.IndexID,
		IndexerID:      event.IndexerID,
		Namespace:      event.Namespace,
		Operation:      event.Operation,
		SourceCount:    event.SourceCount,
		ChunkCount:     event.ChunkCount,
		ReplaceSources: event.ReplaceSources,
		DryRun:         event.DryRun,
	}
	if event.SourceID != "" {
		entry.SourceID = &event.SourceID
	}
	s.indexEvents.Push(entry)

	s.correlate(event.TraceID, "index:start", event.Timestamp, map[string]any{
		"indexId":        event.IndexID,
		"indexerId":      event.IndexerID,
		"namespace":      event.Namespace,
		"operation":      event.Operation,
		"sourceCount":    event.SourceCount,
		"chunkCount":     event.ChunkCount,
		"replaceSources": event.ReplaceSources,
		"sourceId":       event.SourceID,
		"dryRun":         event.DryRun,
	})

	s.mu.Unlock()
	s.notify()
}

// IndexEnd records an index:end event.
func (s *Store) IndexEnd(event IndexEndEvent) {
	s.mu.Lock()

	entry := IndexEventData{
		Kind:           "end",
		TraceID:        event.TraceID,
		Timestamp:      event.Timestamp,
		IndexID:        event.IndexID,
		IndexerID:      event.IndexerID,
		Namespace:      event.Namespace,
		Operation:      event.Operation,
		SourceCount:    event.SourceCount,
		ChunkCount:     event.ChunkCount,
		ReplaceSources: event.ReplaceSources,
		DryRun:         event.DryRun,
	}
	if event.SourceID != "" {
		entry.SourceID = &event.SourceID
	}
	duration := event.DurationMs
	entry.DurationMs = &duration
	if event.DeletedCount != nil {
		entry.DeletedCount = event.DeletedCount
	}
	if event.Error != "" {
		entry.Error = &event.Error
	}
	s.indexEvents.Push(entry)

	s.correlate(event.TraceID, "index:end", event.Timestamp, map[string]any{
		"indexId":        event.IndexID,
		"indexerId":      event.IndexerID,
		"namespace":      event.Namespace,
		"operation":      event.Operation,
		"sourceCount":    event.SourceCount,
		"chunkCount":     event.ChunkCount,
		"replaceSources": event.ReplaceSources,
		"sourceId":       event.SourceID,
		"dryRun":         event.DryRun,
		"durationMs":     event.DurationMs,
		"deletedCount":   event.DeletedCount,
		"stages":         event.Stages,
		"error":          event.Error,
	})

	s.mu.Unlock()
	s.notify()
}

// CorpusSyncStart records a corpus:sync:start event.
func (s *Store) CorpusSyncStart(event CorpusSyncStartEvent) {
	s.mu.Lock()

	sourceCount := event.SourceCount
	entry := CorpusEventData{
		Kind:        "sync:start",
		Type:        "corpus:sync:start",
		SyncID:      event.SyncID,
		CorpusID:    event.CorpusID,
		Namespace:   event.Namespace,
		Mode:        event.Mode,
		StalePolicy: event.StalePolicy,
		SourceSet:   event.SourceSet,
		DryRun:      event.DryRun,
		SourceCount: &sourceCount,
		TraceID:     event.TraceID,
		Timestamp:   event.Timestamp,
	}
	s.corpusEvents.Push(entry)

	s.correlate(event.TraceID, "corpus:sync:start", event.Timestamp, map[string]any{
		"syncId":      event.SyncID,
		"corpusId":    event.CorpusID,
		"namespace":   event.Namespace,
		"mode":        event.Mode,
		"stalePolicy": event.StalePolicy,
		"sourceSet":   event.SourceSet,
		"dryRun":      event.DryRun,
		"sourceCount": event.SourceCount,
	})

	s.mu.Unlock()
	s.notify()
}

// CorpusSource records a corpus:source:* event.
func (s *Store) CorpusSource(eventType string, event CorpusSourceEvent) {
	s.mu.Lock()

	entry := CorpusEventData{
		Kind:       "source",
		Type:       eventType,
		SyncID:     event.SyncID,
		CorpusID:   event.CorpusID,
		Namespace:  event.Namespace,
		SourceID:   event.SourceID,
		Action:     event.Action,
		Reason:     event.Reason,
		DryRun:     event.DryRun,
		ChunkCount: event.ChunkCount,
		Stages:     event.Stages,
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
	}
	if msg, ok := event.Error["message"].(string); ok && msg != "" {
		entry.Error = &msg
	}
	s.corpusEvents.Push(entry)

	s.correlate(event.TraceID, eventType, event.Timestamp, map[string]any{
		"syncId":     event.SyncID,
		"corpusId":   event.CorpusID,
		"namespace":  event.Namespace,
		"sourceId":   event.SourceID,
		"action":     event.Action,
		"reason":     event.Reason,
		"dryRun":     event.DryRun,
		"chunkCount": event.ChunkCount,
		"stages":     event.Stages,
		"error":      event.Error,
	})

	s.mu.Unlock()
	s.notify()
}

// CorpusSyncEnd records a corpus:sync:end event.
func (s *Store) CorpusSyncEnd(event CorpusSyncEndEvent) {
	s.mu.Lock()

	added := event.Added
	changed := event.Changed
	unchanged := event.Unchanged
	stale := event.Stale
	skipped := event.Skipped
	deleted := event.Deleted
	failed := event.Failed
	chunkCount := event.ChunkCount
	duration := event.DurationMs
	entry := CorpusEventData{
		Kind:        "sync:end",
		Type:        "corpus:sync:end",
		SyncID:      event.SyncID,
		CorpusID:    event.CorpusID,
		Namespace:   event.Namespace,
		Mode:        event.Mode,
		StalePolicy: event.StalePolicy,
		SourceSet:   event.SourceSet,
		DryRun:      event.DryRun,
		Added:       &added,
		Changed:     &changed,
		Unchanged:   &unchanged,
		Stale:       &stale,
		Skipped:     &skipped,
		Deleted:     &deleted,
		Failed:      &failed,
		ChunkCount:  &chunkCount,
		DurationMs:  &duration,
		TraceID:     event.TraceID,
		Timestamp:   event.Timestamp,
	}
	s.corpusEvents.Push(entry)

	s.correlate(event.TraceID, "corpus:sync:end", event.Timestamp, map[string]any{
		"syncId":      event.SyncID,
		"corpusId":    event.CorpusID,
		"namespace":   event.Namespace,
		"mode":        event.Mode,
		"stalePolicy": event.StalePolicy,
		"sourceSet":   event.SourceSet,
		"dryRun":      event.DryRun,
		"added":       event.Added,
		"changed":     event.Changed,
		"unchanged":   event.Unchanged,
		"stale":       event.Stale,
		"skipped":     event.Skipped,
		"deleted":     event.Deleted,
		"failed":      event.Failed,
		"chunkCount":  event.ChunkCount,
		"durationMs":  event.DurationMs,
	})

	s.mu.Unlock()
	s.notify()
}

// IngestParseStart records an ingest:parse:start event.
func (s *Store) IngestParseStart(event IngestParseStartEvent) {
	s.mu.Lock()

	entry := IngestEventData{
		Kind:        "start",
		IngestID:    event.IngestID,
		Parser:      event.Parser,
		Format:      event.Format,
		Namespace:   event.Namespace,
		SourceID:    event.SourceID,
		ByteLength:  event.ByteLength,
		ContentType: event.ContentType,
		TraceID:     event.TraceID,
		Timestamp:   event.Timestamp,
	}
	s.ingestEvents.Push(entry)

	s.correlate(event.TraceID, "ingest:parse:start", event.Timestamp, map[string]any{
		"ingestId":    event.IngestID,
		"parser":      event.Parser,
		"format":      event.Format,
		"namespace":   event.Namespace,
		"sourceId":    event.SourceID,
		"byteLength":  event.ByteLength,
		"contentType": event.ContentType,
	})

	s.mu.Unlock()
	s.notify()
}

// IngestParseEnd records an ingest:parse:end event.
func (s *Store) IngestParseEnd(event IngestParseEndEvent) {
	s.mu.Lock()

	duration := event.DurationMs
	partCount := event.PartCount
	warningCount := event.WarningCount
	entry := IngestEventData{
		Kind:         "end",
		IngestID:     event.IngestID,
		Parser:       event.Parser,
		Format:       event.Format,
		Namespace:    event.Namespace,
		SourceID:     event.SourceID,
		ByteLength:   event.ByteLength,
		ContentType:  event.ContentType,
		DurationMs:   &duration,
		PartCount:    &partCount,
		WarningCount: &warningCount,
		TraceID:      event.TraceID,
		Timestamp:    event.Timestamp,
	}
	if event.Error != "" {
		entry.Error = &event.Error
	}
	s.ingestEvents.Push(entry)

	s.correlate(event.TraceID, "ingest:parse:end", event.Timestamp, map[string]any{
		"ingestId":     event.IngestID,
		"parser":       event.Parser,
		"format":       event.Format,
		"namespace":    event.Namespace,
		"sourceId":     event.SourceID,
		"byteLength":   event.ByteLength,
		"contentType":  event.ContentType,
		"durationMs":   event.DurationMs,
		"partCount":    event.PartCount,
		"warningCount": event.WarningCount,
		"error":        event.Error,
	})

	s.mu.Unlock()
	s.notify()
}
