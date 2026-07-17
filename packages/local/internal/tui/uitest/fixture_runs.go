package uitest

import (
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (c *FixtureClient) fixtureRunSpans(traceID string) []api.InspectRunSpan {
	start := c.Now.Add(-14 * time.Minute).UnixMilli()
	cost := 0.044
	return []api.InspectRunSpan{
		{
			ID:         "root",
			Kind:       "agent",
			Op:         "agent",
			Primitive:  api.SpanPrimitiveAgent,
			Name:       "docs_agent.run",
			Status:     "failed",
			StartedAt:  start,
			DurationMs: floatPtr(14_200),
			TokenCount: 18_400,
			Cost:       &cost,
			Attributes: map[string]string{
				"agent.name":     "docs_agent",
				"agent.iter.max": "16",
			},
			LinkedInsightIDs: []string{"INS-014"},
		},
		{
			ID:         "plan",
			ParentID:   "root",
			Kind:       "llm",
			Op:         "llm",
			Primitive:  api.SpanPrimitiveGeneration,
			Name:       "plan",
			Status:     "ok",
			StartedAt:  start + 180,
			DurationMs: floatPtr(620),
		},
		{
			ID:         "retrieve",
			ParentID:   "root",
			Kind:       "agent",
			Op:         "agent",
			Primitive:  api.SpanPrimitiveAgent,
			Name:       "retrieve (loop · 16)",
			Status:     "failed",
			StartedAt:  start + 680,
			DurationMs: floatPtr(9_800),
			TokenCount: 14_820,
			Cost:       &cost,
			Attributes: map[string]string{
				"agent.iter.actual": "16",
				"agent.stop.reason": "novelty<0.05",
				"retriever.k":       "4",
			},
			LinkedInsightIDs: []string{"INS-014", "INS-013"},
		},
		fixtureToolSpan("search-1", "retrieve", traceID, start+900, 540, false),
		fixtureToolSpan("search-2", "retrieve", traceID, start+1_540, 580, true),
		fixtureToolSpan("search-3", "retrieve", traceID, start+2_180, 620, true),
		fixtureToolSpan("search-4", "retrieve", traceID, start+2_860, 600, true),
		fixtureSpan("synthesize", "root", "llm", api.SpanPrimitiveGeneration, "synthesize", start+10_800, 3_200),
		fixtureSpan("verify", "root", "tool", api.SpanPrimitiveTool, "verify_citations", start+13_900, 420),
	}
}

func fixtureSpan(id, parentID, op string, primitive string, name string, startedAt int64, duration float64) api.InspectRunSpan {
	return api.InspectRunSpan{
		ID:         id,
		ParentID:   parentID,
		Kind:       op,
		Op:         op,
		Primitive:  primitive,
		Name:       name,
		Status:     "ok",
		StartedAt:  startedAt,
		DurationMs: floatPtr(duration),
	}
}

func fixtureToolSpan(id, parentID, traceID string, startedAt int64, duration float64, dup bool) api.InspectRunSpan {
	data, _ := json.Marshal(map[string]any{
		"toolName": "rag.search",
		"args":     map[string]any{"query": "typed prompts", "k": 4},
		"result":   map[string]any{"hits": []string{"typed-prompts-definition", "prompt-api"}},
	})
	span := api.InspectRunSpan{
		ID:                id,
		ParentID:          parentID,
		Kind:              "tool",
		Op:                "tool",
		Primitive:         api.SpanPrimitiveTool,
		Name:              `rag.search "typed prompts"`,
		Status:            "ok",
		StartedAt:         startedAt,
		DurationMs:        &duration,
		Duplicate:         dup,
		DuplicateOfSpanID: "rag.search:typed-prompts",
		Attributes:        map[string]string{"trace.id": traceID, "retriever.k": "4"},
		Data:              data,
	}
	if dup {
		span.LinkedInsightIDs = []string{"INS-014"}
	}
	return span
}

func floatPtr(v float64) *float64 {
	return &v
}
