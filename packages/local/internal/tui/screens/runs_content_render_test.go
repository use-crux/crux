package screens

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func TestRenderGenerationDepthSections(t *testing.T) {
	used, total, includedTokens, droppedTokens := 120.0, 200.0, 80.0, 90.0
	node := api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{Family: "generation", Primitive: "generation.call"},
		Request: &observability.RunDetailRequest{
			Contributions: []observability.RunDetailRequestContribution{
				{State: "active", Included: true, SourceID: "context:policy", Tokens: &includedTokens},
				{State: "dropped-budget", SourceID: "context:history", Reason: "token budget", Tokens: &droppedTokens},
			},
			Budget: &observability.RunDetailRequestBudget{UsedTokens: &used, TotalTokens: &total, DroppedCount: 1},
			UserPrompt: &observability.RunDetailPromptTextUserPrompt{
				Segments: []observability.RunDetailPromptTextSegment{
					{Text: "Refund for ", Dynamic: false},
					{Text: "Ada", Dynamic: true, Source: "customer.name"},
				},
			},
		},
		DecisionReport: &observability.TurnDecisionReport{
			Turn: observability.TurnDecisionTurn{Readout: "Used current policy context."},
			Decisions: []observability.TurnDecision{{
				Kind: "context.disposition", Subject: observability.TurnDecisionSubject{Name: "refund policy"},
				Outcome: "active", Reason: observability.TurnDecisionReason{Text: "fresh"},
			}},
		},
	}
	plain := ansi.Strip(renderGenerationDepth(&node, 90))
	for _, want := range []string{
		"REQUEST", "● context", "context:policy", "× context", "context:history", "token budget", "120/200 tok", "dropped 1",
		"PROMPT · AUTHORED VS INTERPOLATED", "[A] authored", "[D] dynamic", "customer.name", "DECISIONS", "Used current policy", "refund policy",
	} {
		if !strings.Contains(plain, want) {
			t.Errorf("generation detail missing %q:\n%s", want, plain)
		}
	}
}

func TestRenderToolPayloadExpandsBoundsAndSanitizes(t *testing.T) {
	node := api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{Family: "tool", Primitive: "tool.call"},
		Artifacts: []observability.ArtifactSummary{
			{Kind: "tool.request", Preview: json.RawMessage(`{"args":{"query":"\u001b[31msecret","nested":{"page":4}}}`)},
			{Kind: "tool.response", Preview: json.RawMessage(`{"result":{"hits":["a","b"],"ok":true}}`)},
		},
	}
	collapsed := ansi.Strip(renderToolDepth(&node, 72, false))
	expanded := renderToolDepth(&node, 72, true)
	expandedPlain := ansi.Strip(expanded)
	for _, want := range []string{"ARGS · COLLAPSED", "RESULT · COLLAPSED", "preview"} {
		if !strings.Contains(collapsed, want) {
			t.Errorf("collapsed tool detail missing %q:\n%s", want, collapsed)
		}
	}
	if strings.Contains(expanded, "\x1b[31m") || !strings.Contains(expandedPlain, `"query": "secret"`) {
		t.Fatalf("expanded tool payload was not terminal-safe:\n%q", expanded)
	}
	if lines := strings.Count(expanded, "\n") + 1; lines > 2*(maxExpandedPayloadLines+5) {
		t.Fatalf("expanded tool payload exceeded line bound: %d", lines)
	}
}

func TestMediaPrimitivePayloadBodyIsHidden(t *testing.T) {
	span := api.InspectRunSpan{
		Kind: "operation",
		Op:   "media.describe",
		Data: json.RawMessage(`{"output":{"inlineData":"SECRET_BYTES"},"model":"gpt-4.1-mini"}`),
	}
	if got := renderPrimitivePayload(span, 80); got != "" {
		t.Fatalf("media payload body was rendered:\n%s", got)
	}
}

func TestRenderMemoryMediaSequenceAndMembers(t *testing.T) {
	memory := api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{
			Primitive: "memory.capture", MemoryID: "conversation",
			Attributes: json.RawMessage(`{"requestedMode":"deferred","disposition":"retained","outcome":"completed"}`),
		},
	}
	if plain := ansi.Strip(renderMemoryCaptureDepth(&memory, 80)); !strings.Contains(plain, "deferred → retained → completed") {
		t.Fatalf("memory disposition missing:\n%s", plain)
	}

	media := api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{Family: "media", Primitive: "media.generate_image"},
		Artifacts: []observability.ArtifactSummary{{
			ArtifactID: "image-output", Kind: "output",
			Preview: json.RawMessage(`{"content":[{"kind":"image","mediaType":"image/png","sizeBytes":42,"sourceCategory":"asset-ref","source":"SECRET_BYTES"}]}`),
		}},
	}
	mediaPlain := ansi.Strip(renderMediaDepth(&media, 80))
	for _, want := range []string{"MEDIA DESCRIPTORS · SANITIZED", "image/png", "42 bytes", "asset-ref", "lineage"} {
		if !strings.Contains(mediaPlain, want) {
			t.Errorf("media descriptor missing %q:\n%s", want, mediaPlain)
		}
	}
	if strings.Contains(mediaPlain, "SECRET_BYTES") {
		t.Fatalf("media detail leaked payload:\n%s", mediaPlain)
	}

	flow := api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{Family: "flow", Primitive: "flow.run"},
		Children: []api.ObservabilityRunDetailNode{
			{SpanSummary: api.ObservabilitySpanSummary{Primitive: "flow.step", StepID: "draft"}},
			{SpanSummary: api.ObservabilitySpanSummary{Primitive: "flow.step", StepID: "review"}},
		},
	}
	if plain := ansi.Strip(renderSequenceDepth(&flow, 80)); !strings.Contains(plain, "draft → review") {
		t.Fatalf("flow sequence missing:\n%s", plain)
	}
	agent := api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{Family: "agent", Primitive: "agent.run"},
		Children: []api.ObservabilityRunDetailNode{
			{SpanSummary: api.ObservabilitySpanSummary{Family: "generation"}},
			{SpanSummary: api.ObservabilitySpanSummary{Family: "tool"}},
		},
	}
	if plain := ansi.Strip(renderSequenceDepth(&agent, 80)); !strings.Contains(plain, "2 activities · 1 tools · 1 generations") {
		t.Fatalf("agent loop summary missing:\n%s", plain)
	}

	detail := api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "root"},
		MemberRuns: []observability.OperationRunDetail{
			{Run: api.ObservabilityRunSummary{RunID: "root"}},
			{Run: api.ObservabilityRunSummary{RunID: "child", Name: "Research member", Status: "ok"}, TriggeredBySpanID: "span-step"},
		},
	}
	if plain := ansi.Strip(renderMemberRuns(detail, 80)); !strings.Contains(plain, "Research member") || !strings.Contains(plain, "via span-step") {
		t.Fatalf("member runs missing:\n%s", plain)
	}
}

func TestOpenFirstMemberRoutesToChildRun(t *testing.T) {
	runs := NewRuns()
	runs.diagnosis = &RunDiagnosis{Raw: api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "root"},
		MemberRuns: []observability.OperationRunDetail{
			{Run: api.ObservabilityRunSummary{RunID: "root"}},
			{
				Run: api.ObservabilityRunSummary{RunID: "child", Name: "Research member"},
				Root: api.ObservabilityRunDetailNode{SpanSummary: api.ObservabilitySpanSummary{
					SpanID: "child-root", RunID: "child", Primitive: "generation.call", Family: "generation",
				}},
			},
		},
	}}
	runs.openFirstMember(testContext, &detailRaceClient{})
	if got := runs.SelectedRunID(); got != "child" {
		t.Fatalf("member drill selected %q, want child", got)
	}
	if runs.diagnosis == nil || runs.diagnosis.Raw.Root.SpanID != "child-root" {
		t.Fatalf("member drill did not project child detail: %#v", runs.diagnosis)
	}
}

func TestOpenFirstMemberKeepsPaneOnCanonicalFilteredProjection(t *testing.T) {
	runs := NewRuns()
	child := api.ObservabilityRunSummary{
		RunID: "child", Name: "Research member", SessionID: "session-a", Status: "ok",
	}
	setRunsForTest(runs,
		child,
		api.ObservabilityRunSummary{RunID: "other", Name: "Unrelated", SessionID: "session-b", Status: "ok"},
	)
	runs.filters.Query = "research"
	runs.filters.Session = "session-a"
	runs.filters.Group = 3
	runs.diagnosis = &RunDiagnosis{Raw: api.ObservabilityRunDetail{
		Run:        api.ObservabilityRunSummary{RunID: "root"},
		MemberRuns: []observability.OperationRunDetail{{Run: child}},
	}}

	runs.openFirstMember(testContext, &detailRaceClient{})
	if got := runs.runList.Position().Total; got != 1 {
		t.Fatalf("member drill pane rows = %d, want one canonical filtered row", got)
	}
	if got := runs.SelectedRunID(); got != child.RunID {
		t.Fatalf("member drill selected %q, want %q", got, child.RunID)
	}
	if got := runs.filteredRuns(); len(got) != 1 || got[0].RunID != child.RunID {
		t.Fatalf("member drill projection = %#v, want filtered child", got)
	}
}

func TestChildRunRefreshKeepsEmbeddedMemberSelected(t *testing.T) {
	runs := NewRuns()
	selectRunForTest(runs, "child")
	operation := api.ObservabilityRunDetail{
		SchemaVersion: 4,
		Run:           api.ObservabilityRunSummary{RunID: "root", Revision: 4},
		MemberRuns: []observability.OperationRunDetail{{
			Run: api.ObservabilityRunSummary{RunID: "child", Name: "Research member", Revision: 3},
			Root: api.ObservabilityRunDetailNode{SpanSummary: api.ObservabilitySpanSummary{
				SpanID: "child-root", RunID: "child", Primitive: "generation.call", Family: "generation",
			}},
		}},
	}
	_, token := runs.detailResource.Begin(testContext, runsDetailOwner("child"), 3)
	runs.applyRunDetail(testContext, resource.ResourceResult[api.ObservabilityRunDetail]{
		Token: token,
		Value: operation,
	}, nil)
	if runs.diagnosis == nil || runs.diagnosis.Summary.RunID != "child" {
		t.Fatalf("operation-scoped refresh replaced child drill: %#v", runs.diagnosis)
	}
	if snapshot := runs.detailResource.Snapshot(); snapshot.Value.Run.RunID != "child" {
		t.Fatalf("child resource retained operation root: %#v", snapshot.Value.Run)
	}
}

func TestRenderSpanSplitBarsHidesMissingData(t *testing.T) {
	if got := renderSpanSplitBars(&api.ObservabilityRunDetailNode{}, 80); got != "" {
		t.Fatalf("empty split bars = %q, want hidden", got)
	}
	node := api.ObservabilityRunDetailNode{
		Timing: observability.RunDetailTiming{SelfMs: 20, ChildrenMs: 80},
		MetricBuckets: observability.RunDetailMetricBuckets{
			Total: json.RawMessage(`{"inputTokens":80,"cacheReadTokens":10,"outputTokens":20}`),
		},
	}
	plain := ansi.Strip(renderSpanSplitBars(&node, 80))
	for _, want := range []string{"time", "self 20ms", "children 80ms", "tokens", "in 80", "cache 10", "out 20"} {
		if !strings.Contains(plain, want) {
			t.Errorf("split bars missing %q:\n%s", want, plain)
		}
	}
}

func TestRunHeaderSanitizesRuntimeFacetAndModelValues(t *testing.T) {
	runs := NewRuns()
	runs.diagnosis = &RunDiagnosis{Raw: api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{Model: "evil\nmodel\x07"},
		Facets: map[string]map[string]int{
			"family": {"\x1b[31mgeneration": 1},
		},
	}}
	plain := ansi.Strip(runs.runHeaderStrip(100))
	if strings.ContainsAny(plain, "\n\r\x07\x1b") {
		t.Fatalf("header retained terminal controls: %q", plain)
	}
	for _, want := range []string{"generation", "evil model"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("sanitized header missing %q: %q", want, plain)
		}
	}
}
