package store

import (
	"encoding/json"
	"testing"
)

func TestGetStats_empty_store(t *testing.T) {
	s := NewStore()
	stats := s.GetStats()

	if stats.TotalExecutions != 0 {
		t.Errorf("TotalExecutions = %d, want 0", stats.TotalExecutions)
	}
	if stats.SuccessCount != 0 {
		t.Errorf("SuccessCount = %d, want 0", stats.SuccessCount)
	}
	if stats.ErrorRate != 0 {
		t.Errorf("ErrorRate = %f, want 0", stats.ErrorRate)
	}
	if stats.ContextCacheHitRate != nil {
		t.Errorf("ContextCacheHitRate = %v, want nil", stats.ContextCacheHitRate)
	}
	if stats.JudgeAvgScore != nil {
		t.Errorf("JudgeAvgScore = %v, want nil", stats.JudgeAvgScore)
	}
}

func TestGetStats_memory_and_judge(t *testing.T) {
	s := NewStore()

	s.MemoryRead(MemoryReadEvent{MemoryID: "m1", MemoryType: "working", Operation: "get", Timestamp: 1000})
	s.MemoryRead(MemoryReadEvent{MemoryID: "m1", MemoryType: "working", Operation: "get", Timestamp: 2000})
	s.MemoryWrite(MemoryWriteEvent{MemoryID: "m1", MemoryType: "working", Operation: "set", Timestamp: 3000})

	s.JudgeResult(JudgeResultEvent{MetricID: "quality", Score: 0.8, Timestamp: 1000})
	s.JudgeResult(JudgeResultEvent{MetricID: "quality", Score: 0.6, Timestamp: 2000})

	stats := s.GetStats()

	if stats.MemoryReadCount != 2 {
		t.Errorf("MemoryReadCount = %d, want 2", stats.MemoryReadCount)
	}
	if stats.MemoryWriteCount != 1 {
		t.Errorf("MemoryWriteCount = %d, want 1", stats.MemoryWriteCount)
	}
	if stats.JudgeAvgScore == nil {
		t.Fatal("JudgeAvgScore is nil")
	}
	if *stats.JudgeAvgScore != 0.7 {
		t.Errorf("JudgeAvgScore = %f, want 0.7", *stats.JudgeAvgScore)
	}
	if mt, ok := stats.MemoryByType["working"]; !ok {
		t.Error("MemoryByType missing 'working'")
	} else {
		if mt.Reads != 2 {
			t.Errorf("working reads = %d, want 2", mt.Reads)
		}
		if mt.Writes != 1 {
			t.Errorf("working writes = %d, want 1", mt.Writes)
		}
	}
}

func TestMemoryBlockEventsPreserveBlockMetadata(t *testing.T) {
	s := NewStore()

	s.MemoryWrite(MemoryWriteEvent{
		MemoryID:       "assistant",
		MemoryType:     "block",
		BlockID:        "facts",
		BlockKind:      "facts",
		NamespaceHash:  "abc123",
		Operation:      "propose",
		WriteMode:      "propose",
		ProposalStatus: "pending",
		EntryKey:       "proposal-1",
		Snapshot:       json.RawMessage(`{"key":"proposal-1","content":"User prefers concise answers"}`),
		Timestamp:      1000,
	})

	events := s.GetMemoryEvents()
	if len(events) != 1 {
		t.Fatalf("memory events = %d, want 1", len(events))
	}
	if events[0].BlockID != "facts" || events[0].BlockKind != "facts" {
		t.Fatalf("block metadata = %q/%q, want facts/facts", events[0].BlockID, events[0].BlockKind)
	}
	if events[0].WriteMode != "propose" || events[0].ProposalStatus != "pending" {
		t.Fatalf("proposal metadata = %q/%q, want propose/pending", events[0].WriteMode, events[0].ProposalStatus)
	}

	instance := s.GetMemoryInstance("assistant")
	if instance == nil {
		t.Fatal("memory instance is nil")
	}
	if instance.MemoryType != "block" || instance.BlockKind != "facts" || instance.NamespaceHash != "abc123" {
		t.Fatalf("instance metadata = %#v", instance)
	}
}

func TestGetStats_context_cache(t *testing.T) {
	s := NewStore()

	s.ContextCacheHit(ContextCacheHitEvent{ContextID: "c1", Timestamp: 1000})
	s.ContextCacheHit(ContextCacheHitEvent{ContextID: "c1", Timestamp: 2000})
	s.ContextCacheHit(ContextCacheHitEvent{ContextID: "c2", Timestamp: 3000})
	s.ContextCacheMiss(ContextCacheMissEvent{ContextID: "c3", Timestamp: 4000})

	stats := s.GetStats()

	if stats.ContextCacheHitCount != 3 {
		t.Errorf("ContextCacheHitCount = %d, want 3", stats.ContextCacheHitCount)
	}
	if stats.ContextCacheMissCount != 1 {
		t.Errorf("ContextCacheMissCount = %d, want 1", stats.ContextCacheMissCount)
	}
	if stats.ContextCacheHitRate == nil {
		t.Fatal("ContextCacheHitRate is nil")
	}
	if *stats.ContextCacheHitRate != 0.75 {
		t.Errorf("ContextCacheHitRate = %f, want 0.75", *stats.ContextCacheHitRate)
	}
}

func TestGetStats_embeddings(t *testing.T) {
	s := NewStore()

	duration := 25.0
	cost := 0.01
	inputTokens := 10
	totalTokens := 10
	dimensions := 1536
	cacheHitCount := 2
	cacheMissCount := 1
	retryCount := 1
	truncatedCount := 1
	rateLimitWaitMs := 3.0

	s.EmbeddingStart(EmbedStartEvent{
		EmbedID:      "emb1",
		Name:         "dense-test",
		Kind:         "dense",
		Operation:    "embedMany",
		InputCount:   3,
		ChunkCount:   2,
		MaxChunkSize: 2,
		Dimensions:   &dimensions,
		Timestamp:    1000,
	})
	s.EmbeddingEnd(EmbedEndEvent{
		EmbedID:      "emb1",
		Name:         "dense-test",
		Kind:         "dense",
		Operation:    "embedMany",
		InputCount:   3,
		ChunkCount:   2,
		MaxChunkSize: 2,
		Dimensions:   &dimensions,
		DurationMs:   duration,
		Usage: map[string]int{
			"inputTokens": inputTokens,
			"totalTokens": totalTokens,
		},
		Cost:            &cost,
		CacheHitCount:   &cacheHitCount,
		CacheMissCount:  &cacheMissCount,
		RetryCount:      &retryCount,
		TruncatedCount:  &truncatedCount,
		RateLimitWaitMs: &rateLimitWaitMs,
		Timestamp:       1010,
	})

	stats := s.GetStats()

	if stats.EmbeddingCallCount != 1 {
		t.Errorf("EmbeddingCallCount = %d, want 1", stats.EmbeddingCallCount)
	}
	if stats.TotalEmbeddingTexts != 3 {
		t.Errorf("TotalEmbeddingTexts = %d, want 3", stats.TotalEmbeddingTexts)
	}
	if stats.AvgEmbeddingDurationMs == nil || *stats.AvgEmbeddingDurationMs != 25 {
		t.Errorf("AvgEmbeddingDurationMs = %v, want 25", stats.AvgEmbeddingDurationMs)
	}
	if stats.TotalEmbeddingTokens != 10 {
		t.Errorf("TotalEmbeddingTokens = %d, want 10", stats.TotalEmbeddingTokens)
	}
	if stats.TotalEmbeddingCost != 0.01 {
		t.Errorf("TotalEmbeddingCost = %f, want 0.01", stats.TotalEmbeddingCost)
	}
	if stats.EmbeddingCacheHitCount != 2 {
		t.Errorf("EmbeddingCacheHitCount = %d, want 2", stats.EmbeddingCacheHitCount)
	}
	if stats.EmbeddingCacheMissCount != 1 {
		t.Errorf("EmbeddingCacheMissCount = %d, want 1", stats.EmbeddingCacheMissCount)
	}
	if stats.EmbeddingRetryCount != 1 {
		t.Errorf("EmbeddingRetryCount = %d, want 1", stats.EmbeddingRetryCount)
	}
	if stats.EmbeddingTruncatedCount != 1 {
		t.Errorf("EmbeddingTruncatedCount = %d, want 1", stats.EmbeddingTruncatedCount)
	}
	if stats.EmbeddingRateLimitWaitMs != 3 {
		t.Errorf("EmbeddingRateLimitWaitMs = %f, want 3", stats.EmbeddingRateLimitWaitMs)
	}
}

func TestGetStats_retrieval_and_indexing(t *testing.T) {
	s := NewStore()

	retrievalDuration := 18.0
	indexDuration := 42.0
	replaceSources := true
	rrfK := 60

	s.RetrievalStart(RetrievalStartEvent{
		RetrievalID:      "ret1",
		RetrieverID:      "docs",
		Namespace:        "knowledge",
		Mode:             "search",
		Query:            "composable retrieval",
		Fusion:           "rrf",
		RRFK:             &rrfK,
		SearchLegs:       []string{"dense", "sparse"},
		SearchCandidates: map[string]int{"dense": 20, "sparse": 30},
		Timestamp:        1000,
	})
	s.RetrievalEnd(RetrievalEndEvent{
		RetrievalID:      "ret1",
		RetrieverID:      "docs",
		Namespace:        "knowledge",
		Mode:             "search",
		Query:            "composable retrieval",
		Fusion:           "rrf",
		RRFK:             &rrfK,
		SearchLegs:       []string{"dense", "sparse"},
		SearchCandidates: map[string]int{"dense": 20, "sparse": 30},
		ResultCount:      3,
		DurationMs:       retrievalDuration,
		Timestamp:        1010,
	})

	s.IndexStart(IndexStartEvent{
		IndexID:        "idx1",
		IndexerID:      "docs",
		Namespace:      "knowledge",
		Operation:      "indexDocuments",
		SourceCount:    2,
		ChunkCount:     6,
		ReplaceSources: &replaceSources,
		Timestamp:      1020,
	})
	s.IndexEnd(IndexEndEvent{
		IndexID:        "idx1",
		IndexerID:      "docs",
		Namespace:      "knowledge",
		Operation:      "indexDocuments",
		SourceCount:    2,
		ChunkCount:     6,
		ReplaceSources: &replaceSources,
		DurationMs:     indexDuration,
		Timestamp:      1030,
	})

	stats := s.GetStats()

	if stats.RetrievalCallCount != 1 {
		t.Errorf("RetrievalCallCount = %d, want 1", stats.RetrievalCallCount)
	}
	if stats.TotalRetrievedHits != 3 {
		t.Errorf("TotalRetrievedHits = %d, want 3", stats.TotalRetrievedHits)
	}
	if stats.AvgRetrievalDurationMs == nil || *stats.AvgRetrievalDurationMs != 18 {
		t.Errorf("AvgRetrievalDurationMs = %v, want 18", stats.AvgRetrievalDurationMs)
	}
	if stats.IndexOperationCount != 1 {
		t.Errorf("IndexOperationCount = %d, want 1", stats.IndexOperationCount)
	}
	if stats.TotalIndexedSources != 2 {
		t.Errorf("TotalIndexedSources = %d, want 2", stats.TotalIndexedSources)
	}
	if stats.TotalIndexedChunks != 6 {
		t.Errorf("TotalIndexedChunks = %d, want 6", stats.TotalIndexedChunks)
	}
	if stats.AvgIndexDurationMs == nil || *stats.AvgIndexDurationMs != 42 {
		t.Errorf("AvgIndexDurationMs = %v, want 42", stats.AvgIndexDurationMs)
	}
}

func TestGetSessions_empty(t *testing.T) {
	s := NewStore()
	sessions := s.GetSessions()
	if len(sessions) != 0 {
		t.Errorf("GetSessions() len = %d, want 0", len(sessions))
	}
}

func TestGetTimeseries_empty(t *testing.T) {
	s := NewStore()
	buckets := s.GetTimeseries(5)
	if len(buckets) != 0 {
		t.Errorf("GetTimeseries on empty store = %d buckets, want 0", len(buckets))
	}
}

func TestGetCompositionStats(t *testing.T) {
	s := NewStore()

	s.CompositionStart(CompositionStartEvent{CompositionID: "c1", Kind: "parallel", Timestamp: 1000})
	s.CompositionEnd(CompositionEndEvent{CompositionID: "c1", Kind: "parallel", Status: "success", DurationMs: 100, AgentCount: 3, Timestamp: 2000})
	s.CompositionStart(CompositionStartEvent{CompositionID: "c2", Kind: "parallel", Timestamp: 3000})
	s.CompositionEnd(CompositionEndEvent{CompositionID: "c2", Kind: "parallel", Status: "error", DurationMs: 200, AgentCount: 2, Timestamp: 4000})

	stats := s.GetCompositionStats()

	p, ok := stats.ByKind["parallel"]
	if !ok {
		t.Fatal("missing 'parallel' in ByKind")
	}
	if p.Total != 2 {
		t.Errorf("parallel total = %d, want 2", p.Total)
	}
	if p.Success != 1 {
		t.Errorf("parallel success = %d, want 1", p.Success)
	}
	if p.Error != 1 {
		t.Errorf("parallel error = %d, want 1", p.Error)
	}
}

func ptrFloat(v float64) *float64 { return &v }
func ptrInt(v int) *int           { return &v }

func _() { _ = json.RawMessage{} } // keep import
