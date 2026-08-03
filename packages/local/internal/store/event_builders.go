package store

func embeddingStartData(event EmbedStartEvent) EmbeddingEventData {
	return EmbeddingEventData{
		Kind:          "start",
		TraceID:       event.TraceID,
		Timestamp:     event.Timestamp,
		EmbedID:       event.EmbedID,
		Name:          event.Name,
		EmbeddingKind: event.Kind,
		Operation:     event.Operation,
		InputCount:    event.InputCount,
		ChunkCount:    event.ChunkCount,
		MaxChunkSize:  event.MaxChunkSize,
		Dimensions:    event.Dimensions,
	}
}

func embeddingEndData(event EmbedEndEvent) EmbeddingEventData {
	entry := EmbeddingEventData{
		Kind:            "end",
		TraceID:         event.TraceID,
		Timestamp:       event.Timestamp,
		EmbedID:         event.EmbedID,
		Name:            event.Name,
		EmbeddingKind:   event.Kind,
		Operation:       event.Operation,
		InputCount:      event.InputCount,
		ChunkCount:      event.ChunkCount,
		MaxChunkSize:    event.MaxChunkSize,
		Dimensions:      event.Dimensions,
		DurationMs:      &event.DurationMs,
		Cost:            event.Cost,
		CacheHitCount:   event.CacheHitCount,
		CacheMissCount:  event.CacheMissCount,
		RetryCount:      event.RetryCount,
		TruncatedCount:  event.TruncatedCount,
		RateLimitWaitMs: event.RateLimitWaitMs,
	}
	if event.Usage != nil {
		if v, ok := event.Usage["inputTokens"]; ok {
			entry.InputTokens = &v
		}
		if v, ok := event.Usage["totalTokens"]; ok {
			entry.TotalTokens = &v
		}
	}
	if event.Error != "" {
		entry.Error = &event.Error
	}
	return entry
}

func retrievalStartData(event RetrievalStartEvent) RetrievalEventData {
	entry := RetrievalEventData{
		Kind:        "start",
		TraceID:     event.TraceID,
		Timestamp:   event.Timestamp,
		RetrievalID: event.RetrievalID,
		RetrieverID: event.RetrieverID,
		Namespace:   event.Namespace,
		Mode:        event.Mode,
		Query:       event.Query,
		Limit:       event.Limit,
		Threshold:   event.Threshold,
		Filter:      event.Filter,
		RRFK:        event.RRFK,
	}
	if event.Fusion != "" {
		entry.Fusion = &event.Fusion
	}
	if len(event.SearchLegs) > 0 {
		entry.SearchLegs = append([]string(nil), event.SearchLegs...)
	}
	if len(event.SearchCandidates) > 0 {
		entry.SearchCandidates = cloneStringIntMap(event.SearchCandidates)
	}
	return entry
}

func retrievalEndData(event RetrievalEndEvent) RetrievalEventData {
	entry := RetrievalEventData{
		Kind:        "end",
		TraceID:     event.TraceID,
		Timestamp:   event.Timestamp,
		RetrievalID: event.RetrievalID,
		RetrieverID: event.RetrieverID,
		Namespace:   event.Namespace,
		Mode:        event.Mode,
		Query:       event.Query,
		Limit:       event.Limit,
		Threshold:   event.Threshold,
		Filter:      event.Filter,
		RRFK:        event.RRFK,
		ResultCount: &event.ResultCount,
		DurationMs:  &event.DurationMs,
	}
	if event.Fusion != "" {
		entry.Fusion = &event.Fusion
	}
	if len(event.SearchLegs) > 0 {
		entry.SearchLegs = append([]string(nil), event.SearchLegs...)
	}
	if len(event.SearchCandidates) > 0 {
		entry.SearchCandidates = cloneStringIntMap(event.SearchCandidates)
	}
	if event.Error != "" {
		entry.Error = &event.Error
	}
	return entry
}

func cloneStringIntMap(input map[string]int) map[string]int {
	output := make(map[string]int, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func retrievalStageStartData(event RetrievalStageStartEvent) RetrievalStageEventData {
	return RetrievalStageEventData{
		Kind:            "stage-start",
		TraceID:         event.TraceID,
		Timestamp:       event.Timestamp,
		RetrievalID:     event.RetrievalID,
		RetrieverID:     event.RetrieverID,
		PipelineID:      event.PipelineID,
		StageName:       event.StageName,
		StageKind:       event.StageKind,
		Phase:           event.Phase,
		InputQueryCount: event.InputQueryCount,
		InputHitCount:   event.InputHitCount,
	}
}

func retrievalStageEndData(event RetrievalStageEndEvent) RetrievalStageEventData {
	entry := RetrievalStageEventData{
		Kind:             "stage-end",
		TraceID:          event.TraceID,
		Timestamp:        event.Timestamp,
		RetrievalID:      event.RetrievalID,
		RetrieverID:      event.RetrieverID,
		PipelineID:       event.PipelineID,
		StageName:        event.StageName,
		StageKind:        event.StageKind,
		Phase:            event.Phase,
		Status:           &event.Status,
		InputQueryCount:  event.InputQueryCount,
		OutputQueryCount: event.OutputQueryCount,
		InputHitCount:    event.InputHitCount,
		OutputHitCount:   event.OutputHitCount,
		DurationMs:       &event.DurationMs,
		WarningCount:     event.WarningCount,
		Preview:          event.Preview,
	}
	if event.Error != "" {
		entry.Error = &event.Error
	}
	return entry
}

func toolStartData(event ToolStartEvent) ToolEventData {
	return ToolEventData{
		Kind:       "start",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		ToolName:   event.ToolName,
		ToolCallID: event.ToolCallID,
	}
}

func toolEndData(event ToolEndEvent) ToolEventData {
	entry := ToolEventData{
		Kind:                 "end",
		TraceID:              event.TraceID,
		Timestamp:            event.Timestamp,
		ToolName:             event.ToolName,
		ToolCallID:           event.ToolCallID,
		DurationMs:           &event.DurationMs,
		Result:               event.Result,
		ModelOutput:          event.ModelOutput,
		ModelOutputType:      event.ModelOutputType,
		OutputSize:           event.OutputSize,
		ModelOutputSize:      event.ModelOutputSize,
		TokenSavingsEstimate: event.TokenSavingsEstimate,
	}
	if event.ModelOutputError != "" {
		entry.ModelOutputError = &event.ModelOutputError
	}
	if event.Error != "" {
		entry.Error = &event.Error
	}
	return entry
}

func toolApprovalRequestData(event ToolApprovalRequestEvent) ToolEventData {
	return ToolEventData{
		Kind:       "approval-request",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		ToolName:   event.ToolName,
		ToolCallID: event.ToolCallID,
		ApprovalID: event.ApprovalID,
		Result:     event.Input,
	}
}

func toolApprovalDecisionData(event ToolApprovalDecisionEvent) ToolEventData {
	entry := ToolEventData{
		Kind:       "approval-decision",
		TraceID:    event.TraceID,
		Timestamp:  event.Timestamp,
		ToolName:   event.ToolName,
		ToolCallID: event.ToolCallID,
		ApprovalID: event.ApprovalID,
		Approved:   &event.Approved,
	}
	if event.Reason != "" {
		entry.Error = &event.Reason
	}
	return entry
}

func compositionStartData(event CompositionStartEvent) CompositionEventData {
	return CompositionEventData{
		Kind:            "start",
		CompositionID:   event.CompositionID,
		TraceID:         event.TraceID,
		Timestamp:       event.Timestamp,
		CompositionKind: event.Kind,
	}
}

func compositionAgentData(event CompositionAgentEvent) CompositionEventData {
	return CompositionEventData{
		Kind:            "agent",
		CompositionID:   event.CompositionID,
		TraceID:         event.TraceID,
		Timestamp:       event.Timestamp,
		AgentID:         event.AgentID,
		AgentDurationMs: &event.DurationMs,
	}
}

func compositionEndData(event CompositionEndEvent) CompositionEventData {
	return CompositionEventData{
		Kind:            "end",
		CompositionID:   event.CompositionID,
		TraceID:         event.TraceID,
		Timestamp:       event.Timestamp,
		CompositionKind: event.Kind,
		Status:          event.Status,
		DurationMs:      &event.DurationMs,
		AgentCount:      &event.AgentCount,
		HandoffCount:    event.HandoffCount,
		HandoffPath:     event.HandoffPath,
	}
}
