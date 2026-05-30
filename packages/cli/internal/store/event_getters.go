package store

func (s *Store) GetMemoryEvents() []MemoryEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.memoryEvents)
}

// GetCompactEvents returns all compaction events.
func (s *Store) GetCompactEvents() []CompactEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.compactEvents)
}

// GetBudgetSnapshots returns all budget snapshots.
func (s *Store) GetBudgetSnapshots() []BudgetSnapshotData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.budgetSnapshots)
}

// GetCostEvents returns all cost events.
func (s *Store) GetCostEvents() []CostEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.costEvents)
}

// GetAgentEvents returns all agent events (blackboard + handoff).
func (s *Store) GetAgentEvents() []AgentEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.agentEvents)
}

// GetJudgeEvents returns all judge events.
func (s *Store) GetJudgeEvents() []JudgeEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.judgeEvents)
}

// GetEmbeddingEvents returns all embedding events.
func (s *Store) GetEmbeddingEvents() []EmbeddingEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.embeddingEvents)
}

// GetRetrievalEvents returns all retrieval events.
func (s *Store) GetRetrievalEvents() []RetrievalEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.retrievalEvents)
}

// GetRetrievalStageEvents returns all retrieval pipeline stage events.
func (s *Store) GetRetrievalStageEvents() []RetrievalStageEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.retrievalStageEvents)
}

// GetWorkspaceEvents returns all workspace operation events.
func (s *Store) GetWorkspaceEvents() []WorkspaceEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.workspaceEvents)
}

// GetIndexEvents returns all index events.
func (s *Store) GetIndexEvents() []IndexEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.indexEvents)
}

// GetCorpusEvents returns all corpus sync/source events.
func (s *Store) GetCorpusEvents() []CorpusEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.corpusEvents)
}

// GetIngestEvents returns all ingest parser events.
func (s *Store) GetIngestEvents() []IngestEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.ingestEvents)
}

// GetDelegateEvents returns all delegate events.
func (s *Store) GetDelegateEvents() []DelegateEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.delegateEvents)
}

// GetToolEvents returns all tool events.
func (s *Store) GetToolEvents() []ToolEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.toolEvents)
}

// GetSecurityEvents returns all security events.
func (s *Store) GetSecurityEvents() []SecurityEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.securityEvents)
}

// GetSecurityByPrompt returns security warnings grouped by prompt ID.
func (s *Store) GetSecurityByPrompt() map[string]SecurityByPrompt {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]SecurityByPrompt)
	for _, e := range s.securityEvents.Items() {
		pid := e.PromptID
		if pid == "" {
			pid = "unknown"
		}
		entry := result[pid]
		entry.Total++
		if entry.ByPattern == nil {
			entry.ByPattern = make(map[string]int)
		}
		entry.ByPattern[e.Pattern]++
		if e.Timestamp > entry.LastSeen {
			entry.LastSeen = e.Timestamp
		}
		result[pid] = entry
	}
	return result
}

// GetCompositionEvents returns all composition events.
func (s *Store) GetCompositionEvents() []CompositionEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.compositionEvents)
}

// GetPlanEvents returns all plan events.
func (s *Store) GetPlanEvents() []PlanEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.planEvents)
}

// GetTaskListEvents returns all task list events.
func (s *Store) GetTaskListEvents() []TaskListEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.taskListEvents)
}

// GetTaskEvents returns all task events.
func (s *Store) GetTaskEvents() []TaskEventData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return readRingItems(s.taskEvents)
}

// GetContextCacheHits returns the number of context cache hits.
func (s *Store) GetContextCacheHits() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.contextCacheHits
}

// GetContextCacheMisses returns the number of context cache misses.
func (s *Store) GetContextCacheMisses() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.contextCacheMisses
}

// GetSemanticCacheHits returns the number of semantic cache hits.
func (s *Store) GetSemanticCacheHits() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.semanticCacheHits
}

// GetSemanticCacheMisses returns the number of semantic cache misses.
func (s *Store) GetSemanticCacheMisses() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.semanticCacheMisses
}

// GetSemanticCacheWrites returns the number of semantic cache writes.
func (s *Store) GetSemanticCacheWrites() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.semanticCacheWrites
}

// GetSkillLoads returns the number of skill load events.
func (s *Store) GetSkillLoads() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.skillLoads
}

// GetSkillCacheHits returns the number of skill cache hits.
func (s *Store) GetSkillCacheHits() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.skillCacheHits
}

// GetSkillCacheMisses returns the number of skill cache misses.
func (s *Store) GetSkillCacheMisses() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.skillCacheMisses
}

// GetSkillResolves returns the number of skill resolve events.
func (s *Store) GetSkillResolves() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.skillResolves
}

// ================================================================
// Memory instance getters.
// ================================================================

// GetMemoryInstances returns all memory instances converted to MemoryInstanceData.
func (s *Store) GetMemoryInstances() []MemoryInstanceData {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if len(s.memoryInstances) == 0 {
		return []MemoryInstanceData{}
	}

	out := make([]MemoryInstanceData, 0, len(s.memoryInstances))
	for _, inst := range s.memoryInstances {
		out = append(out, convertMemoryInstance(inst))
	}
	return out
}

// GetMemoryInstance returns a single memory instance by ID, or nil if not found.
func (s *Store) GetMemoryInstance(memoryID string) *MemoryInstanceData {
	s.mu.RLock()
	defer s.mu.RUnlock()

	inst := s.memoryInstances[memoryID]
	if inst == nil {
		return nil
	}
	data := convertMemoryInstance(inst)
	return &data
}
