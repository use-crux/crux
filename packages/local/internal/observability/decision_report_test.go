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
				Attributes:   json.RawMessage(`{"action":"strip","model":"selected-model","originKind":"step","stepIndex":3,"partIndex":2,"mediaPartType":"image","escalatedToBlock":true}`),
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
				Preview:     json.RawMessage(`{"model":"openai/gpt-5-mini","trace":[{"kind":"router","classifiedAs":"fast","route":"fast","usedDefaultRoute":false,"forced":false}]}`),
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

	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:artifact_routing:0", "routing.router.selected", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:guardrail:span_guardrail", "guardrail.stripped", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:security:span_security", "security.warned", "observed")
	if !hasDecisionTab(report.Decisions, "decision:span_generation:routing:artifact_routing:0", "Routing") {
		t.Fatalf("routing decision missing Routing tab target: %#v", report.Decisions)
	}
	guardrail := findDecision(report.Decisions, "decision:span_generation:guardrail:span_guardrail")
	if guardrail == nil || guardrail.Model != "selected-model" || !guardrail.EscalatedToBlock {
		t.Fatalf("guardrail decision = %#v, want safe selected model and strip escalation", guardrail)
	}
	if guardrail.Location == nil || guardrail.Location.PartType != "image" || guardrail.Location.Origin.Kind != "step" || guardrail.Location.Origin.StepIndex == nil || *guardrail.Location.Origin.StepIndex != 3 || guardrail.Location.Origin.PartIndex != 2 {
		t.Fatalf("guardrail location = %#v, want exact step origin", guardrail.Location)
	}
}

func TestProjectRunDetailProjectsRoutingReceiptTraceIntoTurnDecisionReport(t *testing.T) {
	started := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	runID := "run_routing_receipt"
	traceID := "trace_routing_receipt"
	graph := Graph{
		Run: RunSummary{
			RunID:         runID,
			TraceID:       traceID,
			Name:          "routed receipt",
			RootPrimitive: "routing.fallback",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{
			{
				RunID:      runID,
				TraceID:    traceID,
				SpanID:     "span_route",
				Family:     "routing",
				Primitive:  "routing.fallback",
				Name:       "fallback.resolve",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(100 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs: 100,
			},
			{
				RunID:        runID,
				TraceID:      traceID,
				SpanID:       "span_generation",
				ParentSpanID: "span_route",
				Family:       "generation",
				Primitive:    "generation.stream",
				Name:         "stream answer",
				Status:       "ok",
				StartedAt:    started.Add(120 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(time.Second).Format(time.RFC3339Nano),
				DurationMs:   880,
				Model:        "openai/gpt-5",
				Provider:     "openai",
			},
		},
		Artifacts: []ArtifactSummary{{
			ArtifactID:  "artifact_routing_receipt",
			RunID:       runID,
			TraceID:     traceID,
			SpanID:      "span_route",
			Kind:        "routing.report",
			CreatedAt:   started.Add(90 * time.Millisecond).Format(time.RFC3339Nano),
			ContentType: "application/json",
			Encoding:    "json",
			Preview: json.RawMessage(`{
				"model":"openai/gpt-5",
				"cost":0.42,
				"trace":[
					{"kind":"router","id":"intent","classifiedAs":"unknown","route":"default","usedDefaultRoute":true,"forced":false},
					{"kind":"split","id":"canary","route":"beta","seed":"tenant-42"},
					{"kind":"retry","id":"fast-retry","model":"fast-model","attempts":[
						{"model":"fast-model","status":"error","durationMs":25,"errorCategory":"timeout","error":"timed out","delayMs":50},
						{"model":"fast-model","status":"ok","durationMs":30,"cost":0.03}
					]},
					{"kind":"fallback","id":"recovery","midStreamFailure":true,"attempts":[
						{"model":"fast-model","status":"error","durationMs":35,"errorCategory":"provider_error"},
						{"model":"openai/gpt-5","status":"ok","durationMs":80,"cost":0.2}
					]},
					{"kind":"cascade","id":"quality","acceptedAtTier":1,"budgetExceeded":true,"tiers":[
						{"model":"cheap","status":"rejected","durationMs":20,"cost":0.01,"confidence":0.62},
						{"model":"openai/gpt-5","status":"accepted","durationMs":60,"cost":0.2,"judgeCost":0.04,"confidence":0.93}
					]}
				]
			}`),
		}},
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})
	generation := findRunDetailNode(&detail.Root, "span_generation")
	if generation == nil || generation.DecisionReport == nil {
		t.Fatalf("generation = %#v, want decision report", generation)
	}
	report := generation.DecisionReport

	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:0", "routing.router.default_route", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:1", "routing.split.selected", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:2:0", "routing.retry.attempt_failed", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:2:1", "routing.retry.attempt_succeeded", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:3:0", "routing.fallback.attempt_failed", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:3:1", "routing.fallback.attempt_succeeded", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:4", "routing.cascade.budget_exceeded", "observed")
	assertDecisionOutcome(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:1", "beta")
	assertDecisionOutcome(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:2:0", "attempt 1 error: timeout")
	assertDecisionOutcome(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:3:1", "attempt 2 ok: openai/gpt-5")
	assertDecisionOutcome(t, report.Decisions, "decision:span_generation:routing:artifact_routing_receipt:4", "accepted tier 2")
	assertReportChip(t, report, "routing.default_route", "warn")
	assertReportChip(t, report, "routing.mid_stream_failure", "warn")
	assertReportChip(t, report, "routing.budget_exceeded", "warn")
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

func findDecision(decisions []TurnDecision, id string) *TurnDecision {
	for index := range decisions {
		if decisions[index].ID == id {
			return &decisions[index]
		}
	}
	return nil
}

func hasDecisionTab(decisions []TurnDecision, id string, tab string) bool {
	for _, decision := range decisions {
		if decision.ID == id && decision.Tab != nil && decision.Tab.Tab == tab {
			return true
		}
	}
	return false
}

func assertDecisionOutcome(t *testing.T, decisions []TurnDecision, id string, outcome string) {
	t.Helper()
	for _, decision := range decisions {
		if decision.ID == id {
			if decision.Outcome != outcome {
				t.Fatalf("decision %q outcome = %q, want %q", id, decision.Outcome, outcome)
			}
			return
		}
	}
	t.Fatalf("decision %q missing from %#v", id, decisions)
}

func assertReportChip(t *testing.T, report *TurnDecisionReport, id string, tone string) {
	t.Helper()
	for _, chip := range report.Chips {
		if chip.ID == id {
			if chip.Tone != tone {
				t.Fatalf("chip %q tone = %q, want %q", id, chip.Tone, tone)
			}
			return
		}
	}
	t.Fatalf("chip %q missing from %#v", id, report.Chips)
}
