package uitest

import (
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func (c *FixtureClient) fixtureRunDetail(traceID string) api.ObservabilityRunDetail {
	startedAt := c.Now.Add(-14 * time.Minute)
	metrics, _ := json.Marshal(map[string]any{"totalTokens": 18_400, "costUsd": 0.044})
	root := fixtureRunNode(traceID, "root", "", "agent", api.SpanPrimitiveAgent, "docs_agent.run", "failed", startedAt, 14_200)
	root.AgentID = "docs_agent"
	root.Model = "gpt-5"
	root.Provider = "openai"
	root.Metrics = metrics
	root.Children = []api.ObservabilityRunDetailNode{
		fixtureRunNode(traceID, "plan", "root", "llm", api.SpanPrimitiveGeneration, "plan", "ok", startedAt.Add(180*time.Millisecond), 620),
		fixtureRetrieveNode(traceID, startedAt),
		fixtureRunNode(traceID, "synthesize", "root", "llm", api.SpanPrimitiveGeneration, "synthesize", "ok", startedAt.Add(10_800*time.Millisecond), 3_200),
		fixtureRunNode(traceID, "verify", "root", "tool", api.SpanPrimitiveTool, "verify_citations", "ok", startedAt.Add(13_900*time.Millisecond), 420),
	}
	return api.ObservabilityRunDetail{
		SchemaVersion: 1,
		Run: api.ObservabilityRunSummary{
			RunID:         traceID,
			TraceID:       traceID,
			SessionID:     "session_docs",
			Name:          "docs_agent",
			RootPrimitive: api.SpanPrimitiveAgent,
			Status:        "failed",
			StartedAt:     startedAt.Format(time.RFC3339Nano),
			EndedAt:       startedAt.Add(14_200 * time.Millisecond).Format(time.RFC3339Nano),
			DurationMs:    14_200,
			Model:         "gpt-5",
			Provider:      "openai",
			SpanCount:     9,
			Metrics:       metrics,
		},
		Root:   root,
		Counts: observability.RunDetailCounts{Primary: 9},
	}
}

func fixtureRetrieveNode(traceID string, startedAt time.Time) api.ObservabilityRunDetailNode {
	node := fixtureRunNode(traceID, "retrieve", "root", "agent", api.SpanPrimitiveAgent, "retrieve (loop · 16)", "failed", startedAt.Add(680*time.Millisecond), 9_800)
	node.AgentID = "retrieve"
	node.Attributes, _ = json.Marshal(map[string]any{
		"agent.iter.actual": 16,
		"agent.stop.reason": "novelty<0.05",
		"retriever.k":       4,
	})
	for index, offset := range []int{900, 1_540, 2_180, 2_860} {
		id := "search-" + string(rune('1'+index))
		child := fixtureRunNode(traceID, id, "retrieve", "tool", api.SpanPrimitiveTool, `rag.search "typed prompts"`, "ok", startedAt.Add(time.Duration(offset)*time.Millisecond), []float64{540, 580, 620, 600}[index])
		child.ToolName = "rag.search"
		child.Attributes, _ = json.Marshal(map[string]any{"retriever.k": 4})
		child.Artifacts = []api.ObservabilityArtifactSummary{
			{Kind: "tool.request", Preview: json.RawMessage(`{"args":{"query":"typed prompts","k":4}}`)},
			{Kind: "tool.response", Preview: json.RawMessage(`{"result":{"hits":["typed-prompts-definition","prompt-api"]}}`)},
		}
		node.Children = append(node.Children, child)
	}
	return node
}

func fixtureRunNode(
	traceID, id, parentID, family, primitive, name, status string,
	startedAt time.Time,
	durationMs float64,
) api.ObservabilityRunDetailNode {
	return api.ObservabilityRunDetailNode{
		ID:       id,
		ParentID: parentID,
		SpanSummary: api.ObservabilitySpanSummary{
			SpanID:       id,
			ParentSpanID: parentID,
			RunID:        traceID,
			TraceID:      traceID,
			Family:       family,
			Primitive:    primitive,
			Name:         name,
			Status:       status,
			StartedAt:    startedAt.Format(time.RFC3339Nano),
			EndedAt:      startedAt.Add(time.Duration(durationMs) * time.Millisecond).Format(time.RFC3339Nano),
			DurationMs:   durationMs,
		},
		Display: observability.RunDetailDisplay{Kind: family, Label: name},
		Timing: observability.RunDetailTiming{
			StartedAt:  startedAt.Format(time.RFC3339Nano),
			EndedAt:    startedAt.Add(time.Duration(durationMs) * time.Millisecond).Format(time.RFC3339Nano),
			DurationMs: durationMs,
		},
	}
}
