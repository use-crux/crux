package screens

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// renderSpanWithPayload constructs a minimal Runs state focused on one
// span with the given primitive + payload, then returns the span-detail
// rendered output. Used by every primitive case below.
func renderSpanWithPayload(t *testing.T, primitive string, payload map[string]any) string {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	r := NewRuns()
	r.loaded = true
	r.selRun = "run-x"
	r.detail = &api.QualityRunDetailRecord{
		Run: api.QualityRunRecord{TraceID: "run-x"},
		Spans: []api.QualityRunSpan{
			{
				ID:        "sp1",
				Name:      "span under test",
				Primitive: primitive,
				Kind:      primitive,
				Op:        primitive,
				Data:      json.RawMessage(body),
			},
		},
		Trace: api.QualityTraceRecord{StartedAt: 1716730000000},
	}
	r.selSpan = "sp1"
	return r.renderSpanDetail(80, 60)
}

// TestSpanDetailToolShowsCuratedKVNotJSONDump asserts a tool span's
// detail pane surfaces named kvRows (`tool`, `args`, `result`) instead
// of a JSON pretty-print block. Uses `tool.call` (the detailed primitive
// the backend actually emits) — not the legacy short `tool` form.
func TestSpanDetailToolShowsCuratedKVNotJSONDump(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveToolCall, map[string]any{
		"toolName":   "rag.search",
		"args":       map[string]any{"query": "typed prompts", "k": 4},
		"result":     map[string]any{"hits": []any{"a", "b"}},
		"outputSize": 1234,
	})
	plain := stripANSI(out)
	for _, want := range []string{"TOOL", "tool", "rag.search", "args", "result", "output size", "1234 bytes"} {
		if !strings.Contains(plain, want) {
			t.Errorf("rendered tool span missing %q\nfull output:\n%s", want, plain)
		}
	}
	// JSON-pretty-print markers (multi-line braces, leading-space
	// indent) should NOT appear — those would mean we fell back to a
	// raw payload dump.
	if strings.Contains(plain, "\"toolName\":") {
		t.Errorf("rendered tool span contains JSON-style key — should be curated kvRow, not raw JSON dump")
	}
}

// TestSpanDetailGenerationSurfacesTokens asserts a generation span's
// detail pane breaks `usage.{promptTokens,completionTokens}` into
// their own rows. Uses `generation.call` per real backend output.
func TestSpanDetailGenerationSurfacesTokens(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveGenerationCall, map[string]any{
		"provider":     "openai",
		"model":        "gpt-4o-mini",
		"finishReason": "stop",
		"usage": map[string]any{
			"promptTokens":     float64(820),
			"completionTokens": float64(168),
			"totalTokens":      float64(988),
		},
	})
	plain := stripANSI(out)
	for _, want := range []string{"GENERATION", "openai/gpt-4o-mini", "prompt tok", "820", "output tok", "168", "finish", "stop"} {
		if !strings.Contains(plain, want) {
			t.Errorf("rendered generation span missing %q\nfull output:\n%s", want, plain)
		}
	}
}

// TestSpanDetailRetrievalShowsHits asserts a retrieval span's detail
// pane lists the top hits. Uses `retrieval.query` (the detailed
// primitive the backend emits, not the legacy short form).
func TestSpanDetailRetrievalShowsHits(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveRetrievalQuery, map[string]any{
		"query":       "what is a typed prompt",
		"retrieverId": "docs-search",
		"k":           float64(4),
		"hits": []any{
			map[string]any{"id": "doc-1", "score": 0.92, "content": "typed prompts are…"},
			map[string]any{"id": "doc-2", "score": 0.81, "content": "see also…"},
		},
	})
	plain := stripANSI(out)
	// `HITS` is the subSection header (uppercased), then per-hit rows
	// follow with score + doc id + content snippet.
	for _, want := range []string{"RETRIEVAL", "query", "what is a typed prompt", "retriever", "docs-search", "HITS", "doc-1", "0.92"} {
		if !strings.Contains(plain, want) {
			t.Errorf("rendered retrieval span missing %q\nfull output:\n%q", want, plain)
		}
	}
}

// TestSpanDetailHandoffShowsTransferRow asserts a handoff span's
// detail pane shows the `from → to` transfer row + summary preview.
// Uses `handoff.prepare` per real backend output.
func TestSpanDetailHandoffShowsTransferRow(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveHandoffPrepare, map[string]any{
		"fromAgent":  "triage",
		"toAgent":    "writer",
		"handoffId":  "h-42",
		"summary":    "user wants a refund + reason",
		"inputSize":  float64(420),
		"outputSize": float64(2100),
	})
	plain := stripANSI(out)
	for _, want := range []string{"HANDOFF", "transfer", "triage", "writer", "h-42", "summary", "user wants a refund", "input size", "420 bytes", "output size", "2100 bytes"} {
		if !strings.Contains(plain, want) {
			t.Errorf("rendered handoff span missing %q\nfull output:\n%s", want, plain)
		}
	}
}

// TestSpanDetailFlowRunShowsFlowFields asserts a `flow.run` span
// dispatches to the flow renderer (was falling through to generic
// before the detailed-primitive fix).
func TestSpanDetailFlowRunShowsFlowFields(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveFlowRun, map[string]any{
		"flowId":    "docs_agent",
		"stepId":    "retrieve",
		"stepLabel": "retrieve relevant docs",
	})
	plain := stripANSI(out)
	for _, want := range []string{"FLOW", "flow", "docs_agent", "step", "retrieve"} {
		if !strings.Contains(plain, want) {
			t.Errorf("flow.run span missing %q\nfull:\n%s", want, plain)
		}
	}
}

// TestSpanDetailGenerationStreamUsesGenerationRenderer asserts the
// stream variant of generation dispatches to the same renderer as the
// call variant.
func TestSpanDetailGenerationStreamUsesGenerationRenderer(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveGenerationStream, map[string]any{
		"provider": "anthropic",
		"model":    "claude-3.5-sonnet",
	})
	plain := stripANSI(out)
	if !strings.Contains(plain, "GENERATION") {
		t.Errorf("generation.stream span missing GENERATION header\n%s", plain)
	}
	if !strings.Contains(plain, "anthropic/claude-3.5-sonnet") {
		t.Errorf("generation.stream span missing provider/model row\n%s", plain)
	}
}

// TestSpanDetailDelegateInvokeShowsTargetAgent asserts `delegate.invoke`
// dispatches to the delegate renderer.
func TestSpanDetailDelegateInvokeShowsTargetAgent(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveDelegateInvoke, map[string]any{
		"agent":  "router",
		"to":     "writer",
		"reason": "long-form generation",
	})
	plain := stripANSI(out)
	for _, want := range []string{"DELEGATE", "from", "router", "to", "writer", "reason", "long-form generation"} {
		if !strings.Contains(plain, want) {
			t.Errorf("delegate.invoke span missing %q\nfull:\n%s", want, plain)
		}
	}
}

// TestSpanDetailMemoryReadShowsOp asserts memory.read renders the
// `op` row (teal) so users can tell read vs write at a glance.
func TestSpanDetailMemoryReadShowsOp(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveMemoryRead, map[string]any{
		"op":    "read",
		"scope": "session",
		"key":   "user-preferences",
		"hits":  3,
	})
	plain := stripANSI(out)
	for _, want := range []string{"MEMORY", "op", "read", "scope", "session", "key", "user-preferences", "hits"} {
		if !strings.Contains(plain, want) {
			t.Errorf("memory.read span missing %q\nfull:\n%s", want, plain)
		}
	}
}

// TestSpanDetailScoringJudgeShowsScore asserts `scoring.judge` (real
// primitive name) routes to the judge renderer.
func TestSpanDetailScoringJudgeShowsScore(t *testing.T) {
	out := renderSpanWithPayload(t, api.SpanPrimitiveScoringJudge, map[string]any{
		"judgeName": "rubric-judge",
		"score":     0.72,
		"rationale": "covers key points but missing citations",
	})
	plain := stripANSI(out)
	for _, want := range []string{"JUDGE", "judge", "rubric-judge", "score", "0.720", "rationale", "covers key points"} {
		if !strings.Contains(plain, want) {
			t.Errorf("scoring.judge span missing %q\nfull:\n%s", want, plain)
		}
	}
}

func stripANSI(s string) string {
	// Cheap ANSI escape stripper for assertion-readability. Matches
	// CSI sequences `\x1b[…m` only — enough for lipgloss output.
	var b strings.Builder
	inEsc := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == 0x1b && i+1 < len(s) && s[i+1] == '[' {
			inEsc = true
			i++
			continue
		}
		if inEsc {
			if c == 'm' {
				inEsc = false
			}
			continue
		}
		b.WriteByte(c)
	}
	return b.String()
}
