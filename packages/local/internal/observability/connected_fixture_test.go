package observability

import (
	"context"
	"fmt"
	"testing"
)

// connectedCategoryARefs is a representative set of category-A (directly-observed)
// definition kinds used by the Phase 8 connected fixture. The full manifest lives
// in TypeScript (`DEFINITION_KIND_COVERAGE`); this table proves the Go projection
// and filtered Runs path stay truthful for the mission-critical join surface.
var connectedCategoryARefs = []struct {
	id   string
	kind string
	role string
}{
	{"prompt:connected-greet", "prompt", "resolved-prompt"},
	{"context:connected-brand", "context", "resolved-context"},
	{"tool:connected-lookup", "tool", "invoked-tool"},
	{"agent:connected-planner", "agent", "invoked-agent"},
	{"flow:connected-research", "flow", "invoked-flow"},
	{"rag.retriever:connected-docs", "rag.retriever", "invoked-retriever"},
	{"composition.parallel:connected-fanout", "composition.parallel", "invoked-composition"},
	{"composition.pipeline:connected-pipe", "composition.pipeline", "invoked-composition"},
	{"routing.router:connected-route", "routing.router", "invoked-routing"},
	{"skill:connected-ops", "skill", "loaded-skill"},
	{"guardrail:connected-pii", "guardrail", "invoked-guardrail"},
	{"constraint:connected-format", "constraint", "invoked-constraint"},
	{"task:connected-embed", "task", "invoked-task"},
	{"workspace:connected-ws", "workspace", "invoked-workspace"},
	{"memory:connected-mem", "memory", "invoked-memory"},
	{"rag.recipe:connected-recipe", "rag.recipe", "invoked-recipe"},
	{"rag.reranker:connected-rerank", "rag.reranker", "invoked-reranker"},
	{"blackboard:connected-bb", "blackboard", "invoked-blackboard"},
}

// TestConnectedFixtureDefinitionJoinDeliveryAndCatchup is the Phase 8 connected
// backend fixture: multi-kind DefinitionRef activity, multi-segment lifecycle,
// healthy vs degraded delivery, filtered Runs, activity summary, and revision
// catch-up. Browser/binary smoke is layered on the same projection via make build.
func TestConnectedFixtureDefinitionJoinDeliveryAndCatchup(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	// ── 1. Healthy multi-segment run with a dense DefinitionRef set ──────────
	refs := make([]string, 0, len(connectedCategoryARefs))
	for _, r := range connectedCategoryARefs {
		refs = append(refs, definitionRefJSON(r.id, r.kind, r.role))
	}
	traceHealthy := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	mustIngest(t, service,
		fmt.Sprintf(`{"schemaVersion":2,"recordId":"cf_h_start","type":"run:start","runId":"run_cf_healthy","traceId":%q,"segmentId":"seg_cf_a","segmentSeq":1,"name":"connected healthy","rootPrimitive":"agent.run","startedAt":"2026-07-01T12:00:00.000Z","status":"running","definitionRefs":[%s]}`,
			traceHealthy, joinRefs(refs)),
		`{"schemaVersion":2,"recordId":"cf_h_suspend","type":"run:suspend","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_a","segmentSeq":2,"suspendedAt":"2026-07-01T12:00:01.000Z","reason":"await-tool"}`,
		`{"schemaVersion":2,"recordId":"cf_h_resume","type":"run:resume","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":1,"resumedAt":"2026-07-01T12:00:02.000Z","reason":"tool-done","previousSegmentId":"seg_cf_a"}`,
		fmt.Sprintf(`{"schemaVersion":2,"recordId":"cf_h_span","type":"span","runId":"run_cf_healthy","traceId":%q,"segmentId":"seg_cf_b","segmentSeq":2,"spanId":"sp_cf_h","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-07-01T12:00:02.500Z","status":"ok","definitionRefs":[%s]}`,
			traceHealthy, definitionRefJSON("prompt:connected-greet", "prompt", "resolved-prompt")),
		// Secondary direct-runtime evidence for Quality-primary scorer (scoring.judge span).
		`{"schemaVersion":2,"recordId":"cf_h_judge","type":"span","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":3,"spanId":"sp_cf_judge","family":"scoring","primitive":"scoring.judge","name":"judge","startedAt":"2026-07-01T12:00:02.700Z","status":"ok"}`,
		`{"schemaVersion":2,"recordId":"cf_h_end","type":"run:end","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":4,"endedAt":"2026-07-01T12:00:03.000Z","durationMs":3000,"status":"ok"}`,
	)

	// ── 2. Deliberately degraded sibling run (record-id conflict → ingest_health) ─
	mustIngest(t, service,
		runStartWithRefsJSON("cf_d_start", "run_cf_degraded", "seg_cf_d", 1, "2026-07-01T13:00:00.000Z",
			definitionRefJSON("agent:connected-planner", "agent", "invoked-agent")),
	)
	conflict := mustBatch(t, `{"schemaVersion":2,"recordId":"cf_d_start","type":"run:start","runId":"run_cf_degraded","segmentId":"seg_cf_d","segmentSeq":1,"name":"different payload","rootPrimitive":"agent.run","startedAt":"2026-07-01T13:00:00.000Z","status":"running","definitionRefs":[{"id":"agent:connected-planner","kind":"agent","role":"invoked-agent"}]}`)
	if err := service.Ingest(ctx, conflict); err == nil {
		t.Fatal("expected record identity conflict to degrade delivery health")
	}

	// ── 3. Activity: every connected definition has ≥1 run ───────────────────
	for _, r := range connectedCategoryARefs {
		summary, err := service.DefinitionActivitySummary(ctx, r.id)
		if err != nil {
			t.Fatalf("activity summary for %s: %v", r.id, err)
		}
		if summary.RunCount < 1 {
			t.Fatalf("definition %s: expected runCount ≥ 1, got %+v", r.id, summary)
		}
	}

	// ── 4. Filtered Runs by definition (Catalog View Runs) ───────────────────
	page, err := service.RunsPage(ctx, RunListOptions{DefinitionID: "agent:connected-planner"})
	if err != nil {
		t.Fatalf("filtered runs: %v", err)
	}
	if len(page.Rows) < 2 {
		t.Fatalf("agent:connected-planner should touch healthy+degraded runs, got %d rows", len(page.Rows))
	}
	if page.Revision == 0 {
		t.Fatal("filtered Runs envelope must carry a non-zero revision for reconnect catch-up")
	}
	revisionAfterIngest := page.Revision

	// ── 5. Delivery health axes ──────────────────────────────────────────────
	healthy, err := service.Run(ctx, "run_cf_healthy")
	if err != nil {
		t.Fatalf("load healthy run: %v", err)
	}
	if healthy.SegmentCount != 2 || healthy.OrderingConfidence != "causal" || healthy.GapCount != 0 {
		t.Fatalf("healthy multi-segment projection = %#v", healthy)
	}
	if healthy.DeliveryHealth == nil || healthy.DeliveryHealth.Status != "healthy" {
		t.Fatalf("healthy run delivery = %#v, want healthy", healthy.DeliveryHealth)
	}

	degraded, err := service.Run(ctx, "run_cf_degraded")
	if err != nil {
		t.Fatalf("load degraded run: %v", err)
	}
	if degraded.DeliveryHealth == nil || degraded.DeliveryHealth.Status != "degraded" {
		t.Fatalf("degraded run delivery = %#v, want degraded", degraded.DeliveryHealth)
	}

	// ── 6. Run Detail retains DefinitionRefs (Catalog reverse links) ─────────
	detail, err := service.RunDetail(ctx, "run_cf_healthy")
	if err != nil {
		t.Fatalf("run detail: %v", err)
	}
	if len(detail.DefinitionRefs) < len(connectedCategoryARefs) {
		t.Fatalf("run detail refs = %d, want ≥ %d", len(detail.DefinitionRefs), len(connectedCategoryARefs))
	}

	// ── 7. Revision catch-up: current revision is a no-op delta ───────────────
	catchup, err := service.RunsSince(ctx, revisionAfterIngest)
	if err != nil {
		t.Fatalf("RunsSince current: %v", err)
	}
	if catchup.Expired {
		t.Fatalf("fresh revision %d must not expire: %#v", revisionAfterIngest, catchup)
	}

	// ── 8. Quality-correlation sibling: eval.case run does not pollute definition filters
	mustIngest(t, service,
		`{"schemaVersion":2,"recordId":"cf_q_start","type":"run:start","runId":"run_cf_quality","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_cf_q","segmentSeq":1,"name":"quality case","rootPrimitive":"eval.case","startedAt":"2026-07-01T14:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"cf_q_end","type":"run:end","runId":"run_cf_quality","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_cf_q","segmentSeq":2,"endedAt":"2026-07-01T14:00:01.000Z","status":"ok"}`,
	)
	afterQuality, err := service.RunsPage(ctx, RunListOptions{DefinitionID: "prompt:connected-greet"})
	if err != nil {
		t.Fatalf("filtered after quality: %v", err)
	}
	for _, row := range afterQuality.Rows {
		if row.RunID == "run_cf_quality" {
			t.Fatal("Quality-only eval.case run must not appear under a definition filter")
		}
	}
	if afterQuality.Revision <= revisionAfterIngest {
		t.Fatalf("revision must advance after quality ingest: before=%d after=%d", revisionAfterIngest, afterQuality.Revision)
	}
}
