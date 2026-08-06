package store

import "testing"

func BenchmarkStoreEventIngestionMixed(b *testing.B) {
	s := NewStore()
	dimensions := 768

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ts := int64(i)
		traceID := "trace"
		s.EmbeddingStart(EmbedStartEvent{
			EmbedID:      "embed",
			Name:         "embed chunks",
			Kind:         "document",
			Operation:    "upsert",
			InputCount:   4,
			ChunkCount:   12,
			MaxChunkSize: 512,
			Dimensions:   &dimensions,
			TraceID:      traceID,
			Timestamp:    ts,
		})
		s.RetrievalEnd(RetrievalEndEvent{
			RetrievalID: "retrieval",
			RetrieverID: "main",
			Namespace:   "docs",
			Mode:        "search",
			Query:       "refund policy",
			ResultCount: 5,
			DurationMs:  25,
			TraceID:     traceID,
			Timestamp:   ts,
		})
		s.ToolEnd(ToolEndEvent{
			ToolCallID: "call",
			ToolName:   "search",
			DurationMs: 12,
			TraceID:    traceID,
			Timestamp:  ts,
		})
		s.CompositionEnd(CompositionEndEvent{
			CompositionID: "composition",
			Kind:          "debate",
			Status:        "success",
			DurationMs:    100,
			AgentCount:    3,
			TraceID:       traceID,
			Timestamp:     ts,
		})
	}
}

func BenchmarkStoreSnapshotStatsAfterMixedEvents(b *testing.B) {
	s := NewStore()
	for i := 0; i < DefaultMaxEmbeddingEvents; i++ {
		s.EmbeddingStart(EmbedStartEvent{
			EmbedID:      "embed",
			Name:         "embed chunks",
			Kind:         "document",
			Operation:    "upsert",
			InputCount:   4,
			ChunkCount:   12,
			MaxChunkSize: 512,
			TraceID:      "trace",
			Timestamp:    int64(i),
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = s.GetStats()
	}
}
