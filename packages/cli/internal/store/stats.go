package store

// GetStats computes aggregate statistics across all traces and events.
// Traces with role="resolve" are excluded from all counts.
func (s *Store) GetStats() StatsResult {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var successCount, errorCount, runningCount int
	var totalDuration float64
	var completedCount int
	var totalCost float64
	var totalTokens int

	// Streaming aggregates
	var ttftSum float64
	var ttftCount int
	var throughputSum float64
	var throughputCount int
	var embeddingCallCount int
	var totalEmbeddingTexts int
	var embeddingDurationSum float64
	var embeddingDurationCount int
	var totalEmbeddingTokens int
	var totalEmbeddingCost float64
	var embeddingCacheHitCount int
	var embeddingCacheMissCount int
	var embeddingRetryCount int
	var embeddingTruncatedCount int
	var embeddingRateLimitWaitMs float64
	var retrievalCallCount int
	var retrievalErrorCount int
	var totalRetrievedHits int
	var retrievalStageCount int
	var retrievalStageErrorCount int
	var workspaceOperationCount int
	var workspaceErrorCount int
	var retrievalDurationSum float64
	var retrievalDurationCount int
	var indexOperationCount int
	var indexErrorCount int
	var totalIndexedSources int
	var totalIndexedChunks int
	var indexDurationSum float64
	var indexDurationCount int
	var ingestParseCount int
	var ingestErrorCount int
	var ingestDurationSum float64
	var ingestDurationCount int
	var totalIngestParts int
	var totalIngestWarnings int
	ragEvalFailureCounts := map[string]int{}
	var ragEvalFailedCaseCount int

	// Execution run aggregates are owned by internal/observability. This store
	// now only tracks non-run collection/event buffers used by catalog-style
	// devtools panels.

	for _, e := range s.embeddingEvents.Items() {
		if e.Kind == "start" {
			embeddingCallCount++
			totalEmbeddingTexts += e.InputCount
			continue
		}
		if e.DurationMs != nil {
			embeddingDurationSum += *e.DurationMs
			embeddingDurationCount++
		}
		if e.TotalTokens != nil {
			totalEmbeddingTokens += *e.TotalTokens
		} else if e.InputTokens != nil {
			totalEmbeddingTokens += *e.InputTokens
		}
		if e.Cost != nil {
			totalEmbeddingCost += *e.Cost
		}
		if e.CacheHitCount != nil {
			embeddingCacheHitCount += *e.CacheHitCount
		}
		if e.CacheMissCount != nil {
			embeddingCacheMissCount += *e.CacheMissCount
		}
		if e.RetryCount != nil {
			embeddingRetryCount += *e.RetryCount
		}
		if e.TruncatedCount != nil {
			embeddingTruncatedCount += *e.TruncatedCount
		}
		if e.RateLimitWaitMs != nil {
			embeddingRateLimitWaitMs += *e.RateLimitWaitMs
		}
	}

	for _, e := range s.retrievalEvents.Items() {
		if e.Kind == "start" {
			retrievalCallCount++
			continue
		}
		if e.DurationMs != nil {
			retrievalDurationSum += *e.DurationMs
			retrievalDurationCount++
		}
		if e.ResultCount != nil {
			totalRetrievedHits += *e.ResultCount
		}
		if e.Error != nil {
			retrievalErrorCount++
		}
	}
	for _, e := range s.retrievalStageEvents.Items() {
		if e.Kind == "stage-start" {
			retrievalStageCount++
			continue
		}
		if e.Error != nil {
			retrievalStageErrorCount++
		}
	}

	for _, e := range s.workspaceEvents.Items() {
		workspaceOperationCount++
		if e.Status == "error" || e.Error != nil {
			workspaceErrorCount++
		}
	}

	for _, run := range s.ragEvalList {
		for _, c := range run.CompletedCases {
			if c.Status == "failed" || c.Status == "error" {
				ragEvalFailedCaseCount++
			}
			for _, failureType := range c.FailureTypes {
				ragEvalFailureCounts[failureType]++
			}
		}
	}

	for _, e := range s.indexEvents.Items() {
		if e.Kind == "start" {
			indexOperationCount++
			totalIndexedSources += e.SourceCount
			totalIndexedChunks += e.ChunkCount
			continue
		}
		if e.DurationMs != nil {
			indexDurationSum += *e.DurationMs
			indexDurationCount++
		}
		if e.Error != nil {
			indexErrorCount++
		}
	}

	for _, e := range s.ingestEvents.Items() {
		if e.Kind == "start" {
			ingestParseCount++
			continue
		}
		if e.DurationMs != nil {
			ingestDurationSum += *e.DurationMs
			ingestDurationCount++
		}
		if e.PartCount != nil {
			totalIngestParts += *e.PartCount
		}
		if e.WarningCount != nil {
			totalIngestWarnings += *e.WarningCount
		}
		if e.Error != nil {
			ingestErrorCount++
		}
	}

	// Memory events
	var memoryReadCount, memoryWriteCount int
	memoryByType := make(map[string]MemoryTypeStats)
	for _, e := range s.memoryEvents.Items() {
		mt := e.MemoryType
		if mt == "" {
			mt = "unknown"
		}
		entry := memoryByType[mt]
		if e.Kind == "read" {
			memoryReadCount++
			entry.Reads++
		} else {
			memoryWriteCount++
			entry.Writes++
		}
		memoryByType[mt] = entry
	}

	// Compaction count (only 'end' events)
	var compactionCount int
	for _, e := range s.compactEvents.Items() {
		if e.Kind == "end" {
			compactionCount++
		}
	}

	// Budget level (most recent)
	var budgetLevel *string
	if last, ok := s.budgetSnapshots.Last(); ok {
		budgetLevel = &last.Level
	}

	// Judge average score
	var judgeAvgScore *float64
	judgeItems := s.judgeEvents.Items()
	if len(judgeItems) > 0 {
		var totalScore float64
		for _, e := range judgeItems {
			totalScore += e.Score
		}
		avg := totalScore / float64(len(judgeItems))
		judgeAvgScore = &avg
	}

	// Agent events
	var handoffCount, blackboardUpdateCount int
	var handoffTotalSize int
	for _, e := range s.agentEvents.Items() {
		if e.Kind == "handoff" {
			handoffCount++
			if e.InputSize != nil {
				handoffTotalSize += *e.InputSize
			}
			if e.OutputSize != nil {
				handoffTotalSize += *e.OutputSize
			}
		} else {
			blackboardUpdateCount++
		}
	}

	// Delegate events
	delegateItems := s.delegateEvents.Items()
	delegateCount := len(delegateItems)
	var delegateTotalDuration float64
	var delegateCompleteCount int
	for _, e := range delegateItems {
		if e.Kind == "complete" && e.DurationMs != nil {
			delegateCompleteCount++
			delegateTotalDuration += *e.DurationMs
		}
	}

	// Tool events
	var toolExecutionCount int
	var toolTotalDuration float64
	var toolErrorCount int
	var toolTokenSavingsEstimate int
	var toolApprovalRequestCount int
	var toolApprovalDeniedCount int
	for _, e := range s.toolEvents.Items() {
		if e.Kind == "end" {
			toolExecutionCount++
			if e.DurationMs != nil {
				toolTotalDuration += *e.DurationMs
			}
			if e.Error != nil {
				toolErrorCount++
			}
			if e.TokenSavingsEstimate != nil {
				toolTokenSavingsEstimate += *e.TokenSavingsEstimate
			}
		} else if e.Kind == "approval-request" {
			toolApprovalRequestCount++
		} else if e.Kind == "approval-decision" && e.Approved != nil && !*e.Approved {
			toolApprovalDeniedCount++
		}
	}

	// Derived metrics
	countedTraces := successCount + errorCount + runningCount
	var avgDurationMs float64
	if completedCount > 0 {
		avgDurationMs = float64(int(totalDuration/float64(completedCount) + 0.5))
	}
	var avgCost float64
	if completedCount > 0 {
		avgCost = totalCost / float64(completedCount)
	}
	var errorRate float64
	if countedTraces > 0 {
		errorRate = float64(errorCount) / float64(countedTraces)
	}

	var avgTtftMs *float64
	if ttftCount > 0 {
		v := float64(int(ttftSum/float64(ttftCount) + 0.5))
		avgTtftMs = &v
	}
	var avgThroughput *float64
	if throughputCount > 0 {
		v := float64(int((throughputSum/float64(throughputCount))*10+0.5)) / 10
		avgThroughput = &v
	}
	var avgDelegateDurationMs *float64
	if delegateCompleteCount > 0 {
		v := float64(int(delegateTotalDuration/float64(delegateCompleteCount) + 0.5))
		avgDelegateDurationMs = &v
	}
	var avgHandoffSizeBytes *float64
	if handoffCount > 0 {
		v := float64(int(float64(handoffTotalSize)/float64(handoffCount) + 0.5))
		avgHandoffSizeBytes = &v
	}
	var avgToolDurationMs *float64
	if toolExecutionCount > 0 {
		v := float64(int(toolTotalDuration/float64(toolExecutionCount) + 0.5))
		avgToolDurationMs = &v
	}
	var avgEmbeddingDurationMs *float64
	if embeddingDurationCount > 0 {
		v := float64(int(embeddingDurationSum/float64(embeddingDurationCount) + 0.5))
		avgEmbeddingDurationMs = &v
	}
	var avgRetrievalDurationMs *float64
	if retrievalDurationCount > 0 {
		v := float64(int(retrievalDurationSum/float64(retrievalDurationCount) + 0.5))
		avgRetrievalDurationMs = &v
	}
	var avgIndexDurationMs *float64
	if indexDurationCount > 0 {
		v := float64(int(indexDurationSum/float64(indexDurationCount) + 0.5))
		avgIndexDurationMs = &v
	}
	var avgIngestDurationMs *float64
	if ingestDurationCount > 0 {
		v := float64(int(ingestDurationSum/float64(ingestDurationCount) + 0.5))
		avgIngestDurationMs = &v
	}

	var contextCacheHitRate *float64
	total := s.contextCacheHits + s.contextCacheMisses
	if total > 0 {
		v := float64(s.contextCacheHits) / float64(total)
		contextCacheHitRate = &v
	}

	var semanticCacheHitRate *float64
	semanticTotal := s.semanticCacheHits + s.semanticCacheMisses
	if semanticTotal > 0 {
		v := float64(s.semanticCacheHits) / float64(semanticTotal)
		semanticCacheHitRate = &v
	}

	return StatsResult{
		TotalExecutions:          countedTraces,
		SuccessCount:             successCount,
		ErrorCount:               errorCount,
		RunningCount:             runningCount,
		AvgDurationMs:            avgDurationMs,
		TotalCost:                totalCost,
		AvgCost:                  avgCost,
		TotalTokens:              totalTokens,
		ErrorRate:                errorRate,
		MemoryReadCount:          memoryReadCount,
		MemoryWriteCount:         memoryWriteCount,
		MemoryByType:             memoryByType,
		CompactionCount:          compactionCount,
		BudgetLevel:              budgetLevel,
		JudgeAvgScore:            judgeAvgScore,
		AvgTtftMs:                avgTtftMs,
		AvgThroughput:            avgThroughput,
		StreamingTraceCount:      ttftCount,
		HandoffCount:             handoffCount,
		BlackboardUpdateCount:    blackboardUpdateCount,
		DelegateCount:            delegateCount,
		AvgDelegateDurationMs:    avgDelegateDurationMs,
		AvgHandoffSizeBytes:      avgHandoffSizeBytes,
		ToolExecutionCount:       toolExecutionCount,
		ToolApprovalRequestCount: toolApprovalRequestCount,
		ToolApprovalDeniedCount:  toolApprovalDeniedCount,
		AvgToolDurationMs:        avgToolDurationMs,
		ToolErrorCount:           toolErrorCount,
		ToolTokenSavingsEstimate: toolTokenSavingsEstimate,
		SecurityWarningCount:     s.securityEvents.Len(),
		ContextCacheHitCount:     s.contextCacheHits,
		ContextCacheMissCount:    s.contextCacheMisses,
		ContextCacheHitRate:      contextCacheHitRate,
		SemanticCacheHitCount:    s.semanticCacheHits,
		SemanticCacheMissCount:   s.semanticCacheMisses,
		SemanticCacheWriteCount:  s.semanticCacheWrites,
		SemanticCacheHitRate:     semanticCacheHitRate,
		SkillLoadCount:           s.skillLoads,
		SkillCacheHitCount:       s.skillCacheHits,
		SkillCacheMissCount:      s.skillCacheMisses,
		SkillResolveCount:        s.skillResolves,
		EmbeddingCallCount:       embeddingCallCount,
		TotalEmbeddingTexts:      totalEmbeddingTexts,
		AvgEmbeddingDurationMs:   avgEmbeddingDurationMs,
		TotalEmbeddingTokens:     totalEmbeddingTokens,
		TotalEmbeddingCost:       totalEmbeddingCost,
		EmbeddingCacheHitCount:   embeddingCacheHitCount,
		EmbeddingCacheMissCount:  embeddingCacheMissCount,
		EmbeddingRetryCount:      embeddingRetryCount,
		EmbeddingTruncatedCount:  embeddingTruncatedCount,
		EmbeddingRateLimitWaitMs: embeddingRateLimitWaitMs,
		RetrievalCallCount:       retrievalCallCount,
		RetrievalErrorCount:      retrievalErrorCount,
		AvgRetrievalDurationMs:   avgRetrievalDurationMs,
		TotalRetrievedHits:       totalRetrievedHits,
		RetrievalStageCount:      retrievalStageCount,
		RetrievalStageErrorCount: retrievalStageErrorCount,
		WorkspaceOperationCount:  workspaceOperationCount,
		WorkspaceErrorCount:      workspaceErrorCount,
		RagEvalRunCount:          len(s.ragEvalList),
		RagEvalFailedCaseCount:   ragEvalFailedCaseCount,
		RagEvalFailureCounts:     ragEvalFailureCounts,
		IndexOperationCount:      indexOperationCount,
		IndexErrorCount:          indexErrorCount,
		AvgIndexDurationMs:       avgIndexDurationMs,
		TotalIndexedSources:      totalIndexedSources,
		TotalIndexedChunks:       totalIndexedChunks,
		IngestParseCount:         ingestParseCount,
		IngestErrorCount:         ingestErrorCount,
		AvgIngestDurationMs:      avgIngestDurationMs,
		TotalIngestParts:         totalIngestParts,
		TotalIngestWarnings:      totalIngestWarnings,
	}
}
