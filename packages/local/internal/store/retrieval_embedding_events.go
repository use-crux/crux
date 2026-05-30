package store

// EmbeddingStart records an embed:start event.
func (s *Store) EmbeddingStart(event EmbedStartEvent) {
	s.mutate(func() {
		s.embeddingEvents.Push(embeddingStartData(event))

		s.correlate(event.TraceID, "embed:start", event.Timestamp, map[string]any{
			"embedId":      event.EmbedID,
			"name":         event.Name,
			"kind":         event.Kind,
			"operation":    event.Operation,
			"inputCount":   event.InputCount,
			"chunkCount":   event.ChunkCount,
			"maxChunkSize": event.MaxChunkSize,
			"dimensions":   event.Dimensions,
		})
	})
}

// EmbeddingEnd records an embed:end event.
func (s *Store) EmbeddingEnd(event EmbedEndEvent) {
	s.mutate(func() {
		s.embeddingEvents.Push(embeddingEndData(event))

		s.correlate(event.TraceID, "embed:end", event.Timestamp, map[string]any{
			"embedId":         event.EmbedID,
			"name":            event.Name,
			"kind":            event.Kind,
			"operation":       event.Operation,
			"inputCount":      event.InputCount,
			"chunkCount":      event.ChunkCount,
			"maxChunkSize":    event.MaxChunkSize,
			"dimensions":      event.Dimensions,
			"durationMs":      event.DurationMs,
			"usage":           event.Usage,
			"cost":            event.Cost,
			"cacheHitCount":   event.CacheHitCount,
			"cacheMissCount":  event.CacheMissCount,
			"retryCount":      event.RetryCount,
			"truncatedCount":  event.TruncatedCount,
			"rateLimitWaitMs": event.RateLimitWaitMs,
			"error":           event.Error,
		})
	})
}

// RetrievalStart records a retrieval:start event.
func (s *Store) RetrievalStart(event RetrievalStartEvent) {
	s.mutate(func() {
		s.retrievalEvents.Push(retrievalStartData(event))

		s.correlate(event.TraceID, "retrieval:start", event.Timestamp, map[string]any{
			"retrievalId": event.RetrievalID,
			"retrieverId": event.RetrieverID,
			"namespace":   event.Namespace,
			"mode":        event.Mode,
			"query":       event.Query,
			"limit":       event.Limit,
			"threshold":   event.Threshold,
			"filter":      event.Filter,
			"fusion":      event.Fusion,
		})
	})
}

// RetrievalEnd records a retrieval:end event.
func (s *Store) RetrievalEnd(event RetrievalEndEvent) {
	s.mutate(func() {
		s.retrievalEvents.Push(retrievalEndData(event))

		s.correlate(event.TraceID, "retrieval:end", event.Timestamp, map[string]any{
			"retrievalId": event.RetrievalID,
			"retrieverId": event.RetrieverID,
			"namespace":   event.Namespace,
			"mode":        event.Mode,
			"query":       event.Query,
			"limit":       event.Limit,
			"threshold":   event.Threshold,
			"filter":      event.Filter,
			"fusion":      event.Fusion,
			"resultCount": event.ResultCount,
			"durationMs":  event.DurationMs,
			"error":       event.Error,
		})
	})
}

// RetrievalStageStart records a retrieval:stage:start event.
func (s *Store) RetrievalStageStart(event RetrievalStageStartEvent) {
	s.mutate(func() {
		s.retrievalStageEvents.Push(retrievalStageStartData(event))

		s.correlate(event.TraceID, "retrieval:stage:start", event.Timestamp, map[string]any{
			"retrievalId":     event.RetrievalID,
			"retrieverId":     event.RetrieverID,
			"pipelineId":      event.PipelineID,
			"stageName":       event.StageName,
			"stageKind":       event.StageKind,
			"phase":           event.Phase,
			"inputQueryCount": event.InputQueryCount,
			"inputHitCount":   event.InputHitCount,
		})
	})
}

// RetrievalStageEnd records a retrieval:stage:end event.
func (s *Store) RetrievalStageEnd(event RetrievalStageEndEvent) {
	s.mutate(func() {
		s.retrievalStageEvents.Push(retrievalStageEndData(event))

		s.correlate(event.TraceID, "retrieval:stage:end", event.Timestamp, map[string]any{
			"retrievalId":      event.RetrievalID,
			"retrieverId":      event.RetrieverID,
			"pipelineId":       event.PipelineID,
			"stageName":        event.StageName,
			"stageKind":        event.StageKind,
			"phase":            event.Phase,
			"status":           event.Status,
			"inputQueryCount":  event.InputQueryCount,
			"outputQueryCount": event.OutputQueryCount,
			"inputHitCount":    event.InputHitCount,
			"outputHitCount":   event.OutputHitCount,
			"durationMs":       event.DurationMs,
			"warningCount":     event.WarningCount,
			"error":            event.Error,
		})
	})
}
