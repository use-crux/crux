package store

import (
	"encoding/json"
	"testing"
)

func TestEmbeddingEndDataMapsUsageAndOptionalFields(t *testing.T) {
	dimensions := 768
	cost := 0.012
	cacheHits := 2
	waitMs := 42.5

	got := embeddingEndData(EmbedEndEvent{
		EmbedID:         "embed-1",
		Name:            "index chunks",
		Kind:            "document",
		Operation:       "upsert",
		InputCount:      3,
		ChunkCount:      9,
		MaxChunkSize:    512,
		Dimensions:      &dimensions,
		DurationMs:      123,
		Usage:           map[string]int{"inputTokens": 50, "totalTokens": 64},
		Cost:            &cost,
		CacheHitCount:   &cacheHits,
		RateLimitWaitMs: &waitMs,
		Error:           "quota",
		TraceID:         "trace-1",
		Timestamp:       99,
	})

	if got.Kind != "end" || got.EmbedID != "embed-1" || got.DurationMs == nil || *got.DurationMs != 123 {
		t.Fatalf("embeddingEndData() = %#v", got)
	}
	if got.InputTokens == nil || *got.InputTokens != 50 || got.TotalTokens == nil || *got.TotalTokens != 64 {
		t.Fatalf("embeddingEndData usage = %#v", got)
	}
	if got.Cost != &cost || got.CacheHitCount != &cacheHits || got.RateLimitWaitMs != &waitMs {
		t.Fatalf("embeddingEndData optional fields = %#v", got)
	}
	if got.Error == nil || *got.Error != "quota" {
		t.Fatalf("embeddingEndData error = %#v", got.Error)
	}
}

func TestRetrievalStageEndDataMapsStatusAndPreview(t *testing.T) {
	warnings := 1
	preview := &RetrievalStagePreview{Queries: []map[string]any{{"q": "hello"}}}

	got := retrievalStageEndData(RetrievalStageEndEvent{
		RetrievalID:  "ret-1",
		RetrieverID:  "retriever-1",
		PipelineID:   "pipe-1",
		StageName:    "rerank",
		StageKind:    "ranker",
		Phase:        "reranking",
		Status:       "error",
		DurationMs:   7.5,
		WarningCount: &warnings,
		Error:        "bad score",
		Preview:      preview,
		TraceID:      "trace-1",
		Timestamp:    100,
	})

	if got.Kind != "stage-end" || got.Status == nil || *got.Status != "error" || got.DurationMs == nil || *got.DurationMs != 7.5 {
		t.Fatalf("retrievalStageEndData() = %#v", got)
	}
	if got.WarningCount != &warnings || got.Preview != preview || got.Error == nil || *got.Error != "bad score" {
		t.Fatalf("retrievalStageEndData optional fields = %#v", got)
	}
}

func TestToolEndDataMapsModelOutputFields(t *testing.T) {
	outputSize := 10
	modelOutputSize := 20
	savings := 30

	got := toolEndData(ToolEndEvent{
		ToolCallID:           "call-1",
		ToolName:             "search",
		DurationMs:           45,
		Result:               json.RawMessage(`{"ok":true}`),
		ModelOutput:          json.RawMessage(`{"summary":"done"}`),
		ModelOutputType:      "json",
		OutputSize:           &outputSize,
		ModelOutputSize:      &modelOutputSize,
		TokenSavingsEstimate: &savings,
		ModelOutputError:     "parse",
		Error:                "tool",
		TraceID:              "trace-1",
		Timestamp:            101,
	})

	if got.Kind != "end" || got.ToolName != "search" || got.DurationMs == nil || *got.DurationMs != 45 {
		t.Fatalf("toolEndData() = %#v", got)
	}
	if got.OutputSize != &outputSize || got.ModelOutputSize != &modelOutputSize || got.TokenSavingsEstimate != &savings {
		t.Fatalf("toolEndData optional sizes = %#v", got)
	}
	if got.ModelOutputError == nil || *got.ModelOutputError != "parse" || got.Error == nil || *got.Error != "tool" {
		t.Fatalf("toolEndData errors = %#v", got)
	}
}

func TestCompositionEndDataMapsPointerFields(t *testing.T) {
	handoffs := 2
	got := compositionEndData(CompositionEndEvent{
		CompositionID: "composition-1",
		Kind:          "debate",
		Status:        "success",
		DurationMs:    88,
		AgentCount:    4,
		HandoffCount:  &handoffs,
		HandoffPath:   []string{"a", "b"},
		TraceID:       "trace-1",
		Timestamp:     102,
	})

	if got.Kind != "end" || got.DurationMs == nil || *got.DurationMs != 88 || got.AgentCount == nil || *got.AgentCount != 4 {
		t.Fatalf("compositionEndData() = %#v", got)
	}
	if got.HandoffCount != &handoffs || len(got.HandoffPath) != 2 {
		t.Fatalf("compositionEndData handoff fields = %#v", got)
	}
}
