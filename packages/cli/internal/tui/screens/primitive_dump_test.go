package screens

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/cli/internal/api"
)

// TestDumpPrimitiveRenders writes one ANSI-stripped snapshot per
// primitive type to /tmp/primitive-<name>.txt for side-by-side
// inspection. Gated on PRIM_DUMP=1.
func TestDumpPrimitiveRenders(t *testing.T) {
	if os.Getenv("PRIM_DUMP") != "1" {
		t.Skip("set PRIM_DUMP=1 to dump primitive snapshots")
	}

	cases := []struct {
		name      string
		primitive string
		payload   map[string]any
	}{
		{
			"tool.call",
			api.SpanPrimitiveToolCall,
			map[string]any{
				"toolName":   "rag.search",
				"args":       map[string]any{"query": "typed prompts in crux", "k": 4, "rerank": true},
				"result":     map[string]any{"hits": []any{map[string]any{}, map[string]any{}, map[string]any{}}},
				"outputSize": 2840,
			},
		},
		{
			"generation.call",
			api.SpanPrimitiveGenerationCall,
			map[string]any{
				"provider":     "openai",
				"model":        "gpt-4o-mini",
				"targetId":     "docs_agent",
				"temperature":  0.7,
				"maxTokens":    1024,
				"finishReason": "stop",
				"usage": map[string]any{
					"promptTokens":     float64(1820),
					"completionTokens": float64(412),
					"totalTokens":      float64(2232),
				},
				"toolCalls": []any{map[string]any{}, map[string]any{}},
				"output":    "Typed prompts in Crux let you declare the shape…",
			},
		},
		{
			"flow.run",
			api.SpanPrimitiveFlowRun,
			map[string]any{
				"flowId":    "docs_agent",
				"stepId":    "retrieve",
				"stepLabel": "retrieve relevant docs",
				"stepIds":   []any{"plan", "retrieve", "synthesize", "verify_citations"},
			},
		},
		{
			"handoff.prepare",
			api.SpanPrimitiveHandoffPrepare,
			map[string]any{
				"fromAgent":  "triage",
				"toAgent":    "writer",
				"handoffId":  "h-42",
				"summary":    "user wants a refund and reason for delay",
				"inputSize":  420,
				"outputSize": 2100,
			},
		},
		{
			"delegate.invoke",
			api.SpanPrimitiveDelegateInvoke,
			map[string]any{
				"agent":  "router",
				"to":     "writer",
				"reason": "long-form generation requested",
				"payload": map[string]any{
					"task": "draft response",
					"tone": "empathetic",
				},
			},
		},
		{
			"retrieval.query",
			api.SpanPrimitiveRetrievalQuery,
			map[string]any{
				"query":       "what is a typed prompt",
				"retrieverId": "docs-search",
				"k":           float64(4),
				"hits": []any{
					map[string]any{"id": "doc-tp-1", "score": 0.92, "content": "Typed prompts in Crux are templates that declare their input/output shape with TypeScript."},
					map[string]any{"id": "doc-tp-2", "score": 0.81, "content": "See `createPrompts()` for the canonical builder API."},
					map[string]any{"id": "doc-tp-3", "score": 0.74, "content": "Typed prompts compose with contexts via the `context()` primitive."},
				},
			},
		},
		{
			"memory.read",
			api.SpanPrimitiveMemoryRead,
			map[string]any{
				"op":    "read",
				"scope": "session",
				"key":   "user-preferences",
				"value": map[string]any{"tone": "formal", "length": "concise"},
				"hits":  float64(3),
			},
		},
		{
			"scoring.judge",
			api.SpanPrimitiveScoringJudge,
			map[string]any{
				"judgeName": "rubric-judge",
				"score":     0.72,
				"rationale": "Output covers the key points but is missing citations for two claims.",
				"subScores": map[string]any{
					"relevance":  float64(0.91),
					"factuality": float64(0.68),
					"format":     float64(0.95),
					"citations":  float64(0.34),
				},
			},
		},
	}

	for _, tc := range cases {
		body, _ := json.Marshal(tc.payload)
		r := NewRuns()
		r.loaded = true
		r.selRun = "run-x"
		r.detail = &api.QualityRunDetailRecord{
			Run: api.QualityRunRecord{TraceID: "run-x"},
			Spans: []api.QualityRunSpan{
				{
					ID:        "sp1",
					Name:      tc.name,
					Primitive: tc.primitive,
					Kind:      tc.primitive,
					Op:        tc.primitive,
					Data:      json.RawMessage(body),
				},
			},
			Trace: api.QualityTraceRecord{StartedAt: 1716730000000},
		}
		r.selSpan = "sp1"

		out := stripANSI(r.renderSpanDetail(80, 60))
		// Trim trailing all-whitespace lines for readability.
		lines := strings.Split(out, "\n")
		end := len(lines)
		for end > 0 && strings.TrimSpace(lines[end-1]) == "" {
			end--
		}
		body2 := strings.Join(lines[:end], "\n")

		path := "/tmp/primitive-" + tc.name + ".txt"
		if err := os.WriteFile(path, []byte(body2), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
		fmt.Fprintln(os.Stderr, "==", tc.name, "==")
		fmt.Fprintln(os.Stderr, body2)
		fmt.Fprintln(os.Stderr)
	}
}
