package observability

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProjectRunDetailProjectsOuterRoutingReportReceipt(t *testing.T) {
	started := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	const artifactID = "artifact_router_fallback_receipt"
	graph := Graph{
		Run: RunSummary{
			RunID:         "run_router_fallback_receipt",
			TraceID:       "trace_router_fallback_receipt",
			Name:          "router fallback receipt",
			RootPrimitive: "routing.router",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{
			{
				RunID:      "run_router_fallback_receipt",
				TraceID:    "trace_router_fallback_receipt",
				SpanID:     "span_router",
				Family:     "routing",
				Primitive:  "routing.router",
				Name:       "router.resolve",
				Status:     "ok",
				StartedAt:  started.Format(time.RFC3339Nano),
				EndedAt:    started.Add(100 * time.Millisecond).Format(time.RFC3339Nano),
				DurationMs: 100,
			},
			{
				RunID:        "run_router_fallback_receipt",
				TraceID:      "trace_router_fallback_receipt",
				SpanID:       "span_generation",
				ParentSpanID: "span_router",
				Family:       "generation",
				Primitive:    "generation.call",
				Name:         "generate answer",
				Status:       "ok",
				StartedAt:    started.Add(120 * time.Millisecond).Format(time.RFC3339Nano),
				EndedAt:      started.Add(time.Second).Format(time.RFC3339Nano),
				DurationMs:   880,
			},
		},
		Artifacts: []ArtifactSummary{{
			ArtifactID:  artifactID,
			RunID:       "run_router_fallback_receipt",
			TraceID:     "trace_router_fallback_receipt",
			SpanID:      "span_router",
			Kind:        "routing.report",
			CreatedAt:   started.Add(90 * time.Millisecond).Format(time.RFC3339Nano),
			ContentType: "application/json",
			Encoding:    "json",
			Preview: json.RawMessage(`{
				"model":"model-b",
				"cost":0.02,
				"trace":[
					{"kind":"router","id":"tier","classifiedAs":"resilient","route":"resilient","usedDefaultRoute":false,"forced":false},
					{"kind":"fallback","id":"recovery","attempts":[
						{"model":"model-a","status":"error","durationMs":10,"errorCategory":"rate_limit","error":"rate limited"},
						{"model":"model-b","status":"ok","durationMs":11,"cost":0.02}
					]}
				]
			}`),
		}},
	}

	var preview map[string]json.RawMessage
	if err := json.Unmarshal(graph.Artifacts[0].Preview, &preview); err != nil {
		t.Fatalf("unmarshal canonical receipt preview: %v", err)
	}
	if _, ok := preview["kind"]; ok {
		t.Fatal("canonical routing receipt preview must not include an inner kind")
	}

	detail := ProjectRunDetail(graph, ProjectionOptions{Now: started.Add(2 * time.Second)})
	generation := findRunDetailNode(&detail.Root, "span_generation")
	if generation == nil || generation.DecisionReport == nil {
		t.Fatalf("generation = %#v, want receipt-backed decision report", generation)
	}
	report := generation.DecisionReport
	if report.Turn.Model != "model-b" {
		t.Fatalf("turn model = %q, want concrete receipt model model-b", report.Turn.Model)
	}

	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:"+artifactID+":0", "routing.router.selected", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:"+artifactID+":1:0", "routing.fallback.attempt_failed", "observed")
	assertDecisionReason(t, report.Decisions, "decision:span_generation:routing:"+artifactID+":1:1", "routing.fallback.attempt_succeeded", "observed")

	for _, decision := range report.Decisions {
		if decision.ID != "decision:span_generation:routing:"+artifactID+":1:1" {
			continue
		}
		for _, evidence := range decision.Evidence {
			if evidence.ArtifactID == artifactID && evidence.ArtifactKind == "routing.report" {
				return
			}
		}
		if len(decision.Evidence) == 0 {
			t.Fatalf("fallback decision evidence = %#v, want routing receipt artifact", decision.Evidence)
		}
		t.Fatalf("fallback decision evidence = %#v, want routing receipt artifact", decision.Evidence)
	}
	t.Fatalf("missing fallback success decision for receipt artifact %q", artifactID)
}
