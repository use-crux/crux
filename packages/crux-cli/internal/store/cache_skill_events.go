package store

// ContextCacheHit increments the cache hit counter and correlates.
func (s *Store) ContextCacheHit(event ContextCacheHitEvent) {
	s.mu.Lock()

	s.contextCacheHits++
	s.correlate(event.TraceID, "context:cache:hit", event.Timestamp, map[string]any{
		"contextId": event.ContextID,
		"ageMs":     event.AgeMs,
	})

	s.mu.Unlock()
	s.notify()
}

// ContextCacheMiss increments the cache miss counter and correlates.
func (s *Store) ContextCacheMiss(event ContextCacheMissEvent) {
	s.mu.Lock()

	s.contextCacheMisses++
	s.correlate(event.TraceID, "context:cache:miss", event.Timestamp, map[string]any{
		"contextId":    event.ContextID,
		"resolutionMs": event.ResolutionMs,
	})

	s.mu.Unlock()
	s.notify()
}

// SemanticCacheEvent records semantic-cache activity and increments aggregate counters.
func (s *Store) SemanticCacheEvent(kind string, event SemanticCacheEvent) {
	s.mu.Lock()

	switch kind {
	case "semantic-cache:hit":
		s.semanticCacheHits++
	case "semantic-cache:miss":
		s.semanticCacheMisses++
	case "semantic-cache:write":
		s.semanticCacheWrites++
	}

	s.correlate(event.TraceID, kind, event.Timestamp, map[string]any{
		"cacheId":    event.CacheID,
		"promptId":   event.PromptID,
		"operation":  event.Operation,
		"version":    event.Version,
		"score":      event.Score,
		"durationMs": event.DurationMs,
		"reason":     event.Reason,
		"error":      event.Error,
	})

	s.mu.Unlock()
	s.notify()
}

// ================================================================
// Skill events
// ================================================================

// SkillLoad increments the skill load counter and correlates.
func (s *Store) SkillLoad(event SkillLoadEvent) {
	s.mu.Lock()

	s.skillLoads++
	s.correlate(event.TraceID, "skill:load", event.Timestamp, map[string]any{
		"skillId": event.SkillID,
		"source":  event.Source,
	})

	s.mu.Unlock()
	s.notify()
}

// SkillCacheHit increments the skill cache hit counter and correlates.
func (s *Store) SkillCacheHit(event SkillCacheHitEvent) {
	s.mu.Lock()

	s.skillCacheHits++
	s.correlate(event.TraceID, "skill:cache:hit", event.Timestamp, map[string]any{
		"skillId": event.SkillID,
	})

	s.mu.Unlock()
	s.notify()
}

// SkillCacheMiss increments the skill cache miss counter and correlates.
func (s *Store) SkillCacheMiss(event SkillCacheMissEvent) {
	s.mu.Lock()

	s.skillCacheMisses++
	s.correlate(event.TraceID, "skill:cache:miss", event.Timestamp, map[string]any{
		"skillId": event.SkillID,
	})

	s.mu.Unlock()
	s.notify()
}

// SkillResolve increments the skill resolve counter and correlates.
func (s *Store) SkillResolve(event SkillResolveEvent) {
	s.mu.Lock()

	s.skillResolves++
	s.correlate(event.TraceID, "skill:resolve", event.Timestamp, map[string]any{
		"skillId": event.SkillID,
	})

	s.mu.Unlock()
	s.notify()
}
