package observability

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProjectRunDetailBuildsTurnDecisionReportFromGenerationRequest(t *testing.T) {
	started := time.Date(2026, 6, 30, 8, 0, 0, 0, time.UTC)
	runID := "run_decision_report"
	traceID := "trace_decision_report"
	generation := requestGenerationSpan(runID, traceID, "span_generation", "", "generate support reply", started, "support.reply")
	generation.Model = "gpt-5-mini"
	generation.Provider = "openai"
	generation.Attributes = json.RawMessage(`{"finishReason":"stop"}`)
	generation.Metrics = json.RawMessage(`{"inputTokens":42,"outputTokens":18,"totalTokens":60,"costUsd":0.00042,"ttftMs":125}`)

	graph := Graph{
		Run: RunSummary{
			RunID:         runID,
			TraceID:       traceID,
			Name:          "support reply",
			RootPrimitive: "generation.call",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{generation},
		Artifacts: []ArtifactSummary{
			requestMessagesArtifact(runID, traceID, "artifact_messages", "span_generation", started, "Base prompt.", "context:refund", "artifact_context_refund"),
			decisionReportContextArtifact(runID, traceID, "artifact_context_refund", "span_prompt", started, "context:refund", "Refund policy.", "active", true, "hit"),
			decisionReportContextArtifact(runID, traceID, "artifact_context_disabled", "span_prompt", started, "context:internal", "Internal notes.", "disabled", false, "disabled"),
			decisionReportBudgetArtifact(runID, traceID, "artifact_budget", "span_prompt", started),
		},
		Edges: []EdgeSummary{
			requestConsumedEdge(runID, traceID, "edge_messages", "span_generation", "artifact_messages", started),
			requestConsumedContextEdge(runID, traceID, "edge_context_refund", "artifact_context_refund", "span_generation", started),
			requestConsumedContextEdge(runID, traceID, "edge_context_disabled", "artifact_context_disabled", "span_generation", started),
			requestConsumedContextEdge(runID, traceID, "edge_budget", "artifact_budget", "span_generation", started),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})
	report := detail.Root.DecisionReport
	if report == nil {
		t.Fatal("decision report is nil")
	}
	if report.ReportID != "tdr:run_decision_report:span_generation" || report.RunID != runID || report.TraceID != traceID {
		t.Fatalf("report identity = %#v, want deterministic run/trace identity", report)
	}
	if report.Turn.ID != "span_generation" || report.Turn.Kind != "generation.call" || report.Turn.Model != "gpt-5-mini" || report.Turn.Provider != "openai" {
		t.Fatalf("turn = %#v, want generation metadata", report.Turn)
	}
	if report.Turn.FinishReason != "stop" || report.Turn.Tokens == nil || report.Turn.Tokens.Total != 60 {
		t.Fatalf("turn metrics = %#v, want finish reason and token totals", report.Turn)
	}
	if report.Turn.Readout != "Answered with 1 active context and 1 context dropped by budget." {
		t.Fatalf("readout = %q", report.Turn.Readout)
	}

	if len(report.Saw) != 3 {
		t.Fatalf("saw = %#v, want prompt, active context, and tool", report.Saw)
	}
	if report.Saw[0].Kind != "prompt" || report.Saw[0].Name != "support.reply" || report.Saw[0].Disposition != "active" {
		t.Fatalf("prompt saw row = %#v", report.Saw[0])
	}
	if report.Saw[1].Kind != "context" || report.Saw[1].ID != "context:refund" || report.Saw[1].Cache == nil || report.Saw[1].Cache.Status != "hit" {
		t.Fatalf("context saw row = %#v", report.Saw[1])
	}
	if report.Saw[2].Kind != "tool" || report.Saw[2].Name != "sharedTool" {
		t.Fatalf("tool saw row = %#v", report.Saw[2])
	}

	if len(report.Considered) != 2 {
		t.Fatalf("considered = %#v, want disabled context and budget drop", report.Considered)
	}
	if report.Considered[0].ID != "context:internal" || report.Considered[0].Disposition != "disabled" || report.Considered[0].Reason.Code != "context.disabled" {
		t.Fatalf("disabled context = %#v", report.Considered[0])
	}
	if report.Considered[1].ID != "context:verbose" || report.Considered[1].Disposition != "dropped" || report.Considered[1].ReasonState != "budget" {
		t.Fatalf("budget dropped context = %#v", report.Considered[1])
	}

	if len(report.Cache) != 1 || report.Cache[0].Subject.ID != "context:refund" || report.Cache[0].Status != "hit" {
		t.Fatalf("cache evidence = %#v, want context cache hit", report.Cache)
	}
	if len(report.Decisions) != 6 {
		t.Fatalf("decisions = %#v, want active, disabled, dropped, budget, cache, and tool decisions", report.Decisions)
	}
	assertDecisionReason(t, report.Decisions, "decision:span_generation:budget", "budget.applied", "declared")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:context:verbose", "context.dropped.token_budget", "declared")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:cache:context:refund", "context.cache.hit", "declared")

	if len(report.Source) != 2 || report.Source[0].Group != "Prompt" || report.Source[1].Group != "Contexts" {
		t.Fatalf("source groups = %#v, want prompt and contexts", report.Source)
	}
	if report.Coverage.Total != 6 || len(report.Coverage.Areas) != 6 {
		t.Fatalf("coverage = %#v, want six scorecard areas", report.Coverage)
	}
	if len(report.Gaps) == 0 || report.Gaps[0].EvidenceLevel != "missing" {
		t.Fatalf("gaps = %#v, want explicit missing evidence", report.Gaps)
	}
}

func TestProjectRunDetailAddsRuntimeDecisionEvidenceToTurnDecisionReport(t *testing.T) {
	started := time.Date(2026, 6, 30, 9, 0, 0, 0, time.UTC)
	runID := "run_runtime_decisions"
	traceID := "trace_runtime_decisions"
	graph := Graph{
		Run: RunSummary{
			RunID:         runID,
			TraceID:       traceID,
			Name:          "runtime decisions",
			RootPrimitive: "routing.router",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{
			{
				RunID:      runID,
				TraceID:    traceID,
				SpanID:     "span_router",
				Family:     "routing",
				Primitive:  "routing.router",
				Name:       "router.resolve",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(10 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs: 10,
				Attributes: json.RawMessage(`{"selectedModel":"openai/gpt-5-mini","classifiedAs":"support"}`),
			},
			{
				RunID:        runID,
				TraceID:      traceID,
				SpanID:       "span_generation",
				ParentSpanID: "span_router",
				Family:       "generation",
				Primitive:    "generation.call",
				Name:         "generate support reply",
				Status:       "ok",
				StartedAt:    started.Add(20 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(time.Second).Format(time.RFC3339Nano),
				DurationMs:   980,
				Model:        "openai/gpt-5-mini",
				Provider:     "openai",
			},
			{
				RunID:        runID,
				TraceID:      traceID,
				SpanID:       "span_guardrail",
				ParentSpanID: "span_generation",
				Family:       "guardrail",
				Primitive:    "guardrail.run",
				Name:         "pii",
				Status:       "ok",
				StartedAt:    started.Add(30 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(40 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   10,
			},
			{
				RunID:        runID,
				TraceID:      traceID,
				SpanID:       "span_security",
				ParentSpanID: "span_generation",
				Family:       "security",
				Primitive:    "security.warning",
				Name:         "prompt injection",
				Status:       "warn",
				StartedAt:    started.Add(50 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(60 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs:   10,
			},
		},
		Artifacts: []ArtifactSummary{
			requestMessagesArtifact(runID, traceID, "artifact_messages", "span_generation", started.Add(20*time.Millisecond), "Base prompt.", "", ""),
			{
				ArtifactID:  "artifact_routing",
				RunID:       runID,
				TraceID:     traceID,
				SpanID:      "span_router",
				Kind:        "routing.report",
				CreatedAt:   started.Add(5 * time.Millisecond).Format(time.RFC3339Nano),
				ContentType: "application/json",
				Encoding:    "json",
				Preview:     json.RawMessage(`{"kind":"routing.report","routingKind":"router","chosen":"openai/gpt-5-mini"}`),
			},
			{
				ArtifactID:  "artifact_security",
				RunID:       runID,
				TraceID:     traceID,
				SpanID:      "span_security",
				Kind:        "security.report",
				CreatedAt:   started.Add(60 * time.Millisecond).Format(time.RFC3339Nano),
				ContentType: "application/json",
				Encoding:    "json",
				Preview:     json.RawMessage(`{"kind":"security.report","severity":"warn","action":"warn"}`),
			},
		},
		Edges: []EdgeSummary{
			requestConsumedEdge(runID, traceID, "edge_messages", "span_generation", "artifact_messages", started.Add(20*time.Millisecond)),
		},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})
	generation := findRunDetailNode(&detail.Root, "span_generation")
	if generation == nil || generation.DecisionReport == nil {
		t.Fatalf("generation = %#v, want decision report", generation)
	}
	report := generation.DecisionReport

	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:span_router", "routing.router.selected", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:guardrail:span_guardrail", "guardrail.passed", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:security:span_security", "security.warned", "observed")
	if !hasDecisionTab(report.Decisions, "decision:span_generation:routing:span_router", "Routing") {
		t.Fatalf("routing decision missing Routing tab target: %#v", report.Decisions)
	}
}

func decisionReportContextArtifact(runID, traceID, artifactID, spanID string, created time.Time, sourceID, text, state string, included bool, cacheStatus string) ArtifactSummary {
	preview, _ := json.Marshal(map[string]any{
		"kind":           "context.contribution",
		"state":          state,
		"included":       included,
		"sourceId":       sourceID,
		"injectableKind": "context",
		"reason":         state,
		"injects":        []string{"system"},
		"priority":       50,
		"tokens":         2,
		"cacheStatus":    cacheStatus,
		"text":           text,
	})
	return ArtifactSummary{
		ArtifactID:  artifactID,
		RunID:       runID,
		TraceID:     traceID,
		SpanID:      spanID,
		Kind:        "context.contribution",
		CreatedAt:   created.Format(time.RFC3339Nano),
		ContentType: "application/json",
		Encoding:    "json",
		Preview:     preview,
	}
}

func decisionReportBudgetArtifact(runID, traceID, artifactID, spanID string, created time.Time) ArtifactSummary {
	return ArtifactSummary{
		ArtifactID:  artifactID,
		RunID:       runID,
		TraceID:     traceID,
		SpanID:      spanID,
		Kind:        "prompt.budget",
		CreatedAt:   created.Format(time.RFC3339Nano),
		ContentType: "application/json",
		Encoding:    "json",
		Preview: json.RawMessage(`{
			"kind":"prompt.budget",
			"usedTokens":42,
			"totalTokens":50,
			"dropped":[{
				"kind":"context.contribution",
				"state":"dropped-budget",
				"included":false,
				"sourceId":"context:verbose",
				"injectableKind":"context",
				"reason":"token budget",
				"priority":1,
				"tokens":80
			}]
		}`),
	}
}

func assertDecisionReason(t *testing.T, decisions []TurnDecision, id string, code string, evidenceLevel string) {
	t.Helper()
	for _, decision := range decisions {
		if decision.ID != id {
			continue
		}
		if decision.Reason.Code != code || decision.Reason.EvidenceLevel != evidenceLevel {
			t.Fatalf("decision %q reason = %#v, want %s/%s", id, decision.Reason, code, evidenceLevel)
		}
		return
	}
	t.Fatalf("decision %q missing from %#v", id, decisions)
}

func hasDecisionTab(decisions []TurnDecision, id string, tab string) bool {
	for _, decision := range decisions {
		if decision.ID == id && decision.Tab != nil && decision.Tab.Tab == tab {
			return true
		}
	}
	return false
}
