package screens

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

// TestRealShapeProjectionSurfacesPerPrimitiveFields drives data shaped
// the way the backend actually emits it (top-level typed fields on
// SpanSummary like Model/ToolName/FlowID, metrics with inputTokens/
// outputTokens, attached artifacts for args/result/hits) through the
// FULL TUI projection path: ObservabilityRunDetail →
// inspectRunDetailFromObservabilityDetail → renderSpanDetail.
//
// The unit tests in runs_span_detail_test.go bypass the projector and
// hand a synthetic Data blob straight to the renderer — they pass even
// when projection drops the fields. This one exercises the actual path
// taken by fetchRunDetail() at runtime.
func TestRealShapeProjectionSurfacesPerPrimitiveFields(t *testing.T) {
	cases := []struct {
		name string
		node observability.RunDetailNode
		want []string
	}{
		{
			name: "tool.call surfaces toolName + tool.request args + tool.response result",
			node: observability.RunDetailNode{
				SpanSummary: observability.SpanSummary{
					SpanID:    "sp_tool",
					Primitive: "tool.call",
					Family:    "tool",
					Name:      "search docs",
					Status:    "ok",
					ToolName:  "searchDocs",
				},
				ID:      "sp_tool",
				Kind:    "tool.call",
				Display: observability.RunDetailDisplay{Kind: "tool.call", Label: "searchDocs"},
				Timing:  observability.RunDetailTiming{StartedAt: "2026-05-16T18:00:00.000Z"},
				Artifacts: []observability.ArtifactSummary{
					{
						ArtifactID: "art_req",
						Kind:       "tool.request",
						Preview:    json.RawMessage(`{"toolName":"searchDocs","toolCallId":"call_1","args":{"query":"typed prompts","k":4}}`),
						Attributes: json.RawMessage(`{"toolName":"searchDocs","toolCallId":"call_1"}`),
					},
					{
						ArtifactID: "art_res",
						Kind:       "tool.response",
						SizeBytes:  2840,
						Preview:    json.RawMessage(`{"hits":[{"id":"d1"},{"id":"d2"}]}`),
					},
				},
			},
			want: []string{"TOOL", "searchDocs", "args", "result", "output size", "2840 bytes"},
		},
		{
			name: "generation.call surfaces provider/model + metrics tokens + output artifact",
			node: observability.RunDetailNode{
				SpanSummary: observability.SpanSummary{
					SpanID:    "sp_gen",
					Primitive: "generation.call",
					Family:    "generation",
					Name:      "generate support reply",
					Status:    "ok",
					Provider:  "openai",
					Model:     "gpt-4o",
					PromptID:  "support.reply",
					// metrics from span end record
					Metrics:    json.RawMessage(`{"inputTokens":42,"outputTokens":18,"totalTokens":60,"costUsd":0.00042}`),
					Attributes: json.RawMessage(`{"finishReason":"stop","temperature":0.2}`),
				},
				ID:      "sp_gen",
				Kind:    "generation.call",
				Display: observability.RunDetailDisplay{Kind: "generation.call", Label: "generate support reply"},
				Timing:  observability.RunDetailTiming{StartedAt: "2026-05-16T18:00:00.010Z"},
				MetricBuckets: observability.RunDetailMetricBuckets{
					Total: json.RawMessage(`{"inputTokens":42,"outputTokens":18,"totalTokens":60,"costUsd":0.00042}`),
				},
				Artifacts: []observability.ArtifactSummary{
					{
						ArtifactID: "art_out",
						Kind:       "output",
						Preview:    json.RawMessage(`{"answer":"Monthly plans are refundable within 14 days."}`),
					},
				},
			},
			want: []string{"GENERATION", "openai/gpt-4o", "prompt tok", "42", "output tok", "18", "finish", "stop"},
		},
		{
			name: "flow.run surfaces flowId + stepId",
			node: observability.RunDetailNode{
				SpanSummary: observability.SpanSummary{
					SpanID:    "sp_flow",
					Primitive: "flow.run",
					Family:    "flow",
					Name:      "docs_agent",
					Status:    "running",
					FlowID:    "docs_agent",
					StepID:    "retrieve",
				},
				ID:      "sp_flow",
				Kind:    "flow.run",
				Display: observability.RunDetailDisplay{Kind: "flow.run", Label: "docs_agent"},
				Timing:  observability.RunDetailTiming{StartedAt: "2026-05-16T18:00:00.020Z"},
			},
			want: []string{"FLOW", "flow", "docs_agent", "step", "retrieve"},
		},
		{
			name: "retrieval.query surfaces query + retrieverId + hits artifact",
			node: observability.RunDetailNode{
				SpanSummary: observability.SpanSummary{
					SpanID:      "sp_ret",
					Primitive:   "retrieval.query",
					Family:      "retrieval",
					Name:        "doc search",
					Status:      "ok",
					RetrieverID: "docs-search",
					Attributes:  json.RawMessage(`{"query":"what is a typed prompt","k":4}`),
				},
				ID:      "sp_ret",
				Kind:    "retrieval.query",
				Display: observability.RunDetailDisplay{Kind: "retrieval.query", Label: "doc search"},
				Timing:  observability.RunDetailTiming{StartedAt: "2026-05-16T18:00:00.030Z"},
				Artifacts: []observability.ArtifactSummary{
					{
						ArtifactID: "art_hits",
						Kind:       "retrieval.hits",
						Preview:    json.RawMessage(`{"hits":[{"id":"doc-1","score":0.92,"content":"typed prompts are…"},{"id":"doc-2","score":0.81,"content":"see also…"}]}`),
					},
				},
			},
			want: []string{"RETRIEVAL", "what is a typed prompt", "docs-search", "HITS", "doc-1", "0.92"},
		},
		{
			name: "handoff.prepare surfaces from→to + summary from artifact",
			node: observability.RunDetailNode{
				SpanSummary: observability.SpanSummary{
					SpanID:    "sp_handoff",
					Primitive: "handoff.prepare",
					Family:    "handoff",
					Name:      "triage → writer",
					Status:    "ok",
					Attributes: json.RawMessage(
						`{"fromAgent":"triage","toAgent":"writer","handoffId":"h-42","summary":"user wants a refund"}`,
					),
				},
				ID:      "sp_handoff",
				Kind:    "handoff.prepare",
				Display: observability.RunDetailDisplay{Kind: "handoff.prepare", Label: "triage → writer"},
				Timing:  observability.RunDetailTiming{StartedAt: "2026-05-16T18:00:00.040Z"},
				Artifacts: []observability.ArtifactSummary{
					{
						ArtifactID: "art_handoff",
						Kind:       "handoff.payload",
						SizeBytes:  25,
						Preview:    json.RawMessage(`{"handoffId":"h-42","data":{"notes":"done"}}`),
						Attributes: json.RawMessage(`{"handoffId":"h-42","inputSize":13,"outputSize":25}`),
					},
				},
			},
			want: []string{"HANDOFF", "triage", "writer", "h-42", "summary", "user wants a refund"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			detail := api.ObservabilityRunDetail{
				Run: observability.RunSummary{
					RunID:     tc.node.SpanID + "_run",
					Status:    "ok",
					StartedAt: tc.node.Timing.StartedAt,
				},
				Root: tc.node,
			}
			projected := inspectRunDetailFromObservabilityDetail(detail)
			if len(projected.Spans) == 0 {
				t.Fatalf("projection produced no spans")
			}

			r := NewRuns()
			r.selRun = projected.Run.TraceID
			d := projected
			r.detail = &d
			r.selSpan = projected.Spans[0].ID

			plain := stripANSI(r.renderSpanDetail(80, 60))
			for _, want := range tc.want {
				if !strings.Contains(plain, want) {
					t.Errorf("missing %q in rendered span detail.\n--- output ---\n%s\n--------------", want, plain)
				}
			}
		})
	}
}
