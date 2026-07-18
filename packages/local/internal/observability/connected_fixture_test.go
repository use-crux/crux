package observability

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

type connectedCoverageFixture struct {
	Adapters []string                `json:"adapters"`
	Cases    []connectedCoverageCase `json:"cases"`
}

type connectedCoverageCase struct {
	Kind                  string         `json:"kind"`
	ExpectedTreatment     string         `json:"expectedTreatment"`
	RuntimePrimitiveNames []string       `json:"runtimePrimitiveNames"`
	DefinitionRef         *DefinitionRef `json:"definitionRef"`
}

func loadConnectedCoverageFixture(t *testing.T) connectedCoverageFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../core/src/project-index/fixtures/definition-coverage.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture connectedCoverageFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

// TestConnectedFixtureDefinitionJoinDeliveryAndCatchup is the Phase 8 connected
// backend fixture: multi-kind DefinitionRef activity, multi-segment lifecycle,
// healthy vs degraded delivery, filtered Runs, activity summary, and revision
// catch-up. Browser/binary smoke is layered on the same projection via make build.
func TestConnectedFixtureDefinitionJoinDeliveryAndCatchup(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	fixture := loadConnectedCoverageFixture(t)

	// ── 1. Healthy multi-segment run with a dense DefinitionRef set ──────────
	refs := make([]string, 0, len(fixture.Cases))
	for _, entry := range fixture.Cases {
		if entry.ExpectedTreatment == "definition-ref" {
			if entry.DefinitionRef == nil {
				t.Fatalf("definition-ref treatment for %s has no ref", entry.Kind)
			}
			refs = append(refs, definitionRefJSON(entry.DefinitionRef.ID, entry.DefinitionRef.Kind, entry.DefinitionRef.Role))
		} else if entry.DefinitionRef != nil {
			t.Fatalf("non-direct treatment for %s fabricated a ref: %+v", entry.Kind, entry.DefinitionRef)
		}
	}
	traceHealthy := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	mustIngest(t, service,
		fmt.Sprintf(`{"schemaVersion":2,"recordId":"cf_h_start","type":"run:start","runId":"run_cf_healthy","traceId":%q,"segmentId":"seg_cf_a","segmentSeq":1,"name":"connected healthy","rootPrimitive":"agent.run","startedAt":"2026-07-01T12:00:00.000Z","status":"running","definitionRefs":[%s]}`,
			traceHealthy, joinRefs(refs)),
		`{"schemaVersion":2,"recordId":"cf_h_suspend","type":"run:suspend","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_a","segmentSeq":2,"suspendedAt":"2026-07-01T12:00:01.000Z","reason":"await-tool"}`,
		`{"schemaVersion":2,"recordId":"cf_h_resume","type":"run:resume","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":1,"resumedAt":"2026-07-01T12:00:02.000Z","reason":"tool-done","previousSegmentId":"seg_cf_a"}`,
		fmt.Sprintf(`{"schemaVersion":2,"recordId":"cf_h_span","type":"span","runId":"run_cf_healthy","traceId":%q,"segmentId":"seg_cf_b","segmentSeq":2,"spanId":"sp_cf_h","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-07-01T12:00:02.500Z","status":"ok","definitionRefs":[%s]}`,
			traceHealthy, definitionRefJSON("prompt:connected", "prompt", "resolved-prompt")),
		`{"schemaVersion":2,"recordId":"cf_h_openai","type":"span","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":3,"spanId":"sp_cf_openai","family":"generation","primitive":"generation.call","name":"openai","startedAt":"2026-07-01T12:00:02.600Z","status":"ok","provider":"openai","attributes":{"adapterPackage":"@use-crux/openai"}}`,
		`{"schemaVersion":2,"recordId":"cf_h_anthropic","type":"span","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":4,"spanId":"sp_cf_anthropic","family":"generation","primitive":"generation.call","name":"anthropic","startedAt":"2026-07-01T12:00:02.620Z","status":"ok","provider":"anthropic","attributes":{"adapterPackage":"@use-crux/anthropic"}}`,
		`{"schemaVersion":2,"recordId":"cf_h_google","type":"span","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":5,"spanId":"sp_cf_google","family":"generation","primitive":"generation.call","name":"google","startedAt":"2026-07-01T12:00:02.640Z","status":"ok","provider":"google","attributes":{"adapterPackage":"@use-crux/google"}}`,
		`{"schemaVersion":2,"recordId":"cf_h_ai","type":"span","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":6,"spanId":"sp_cf_ai","family":"generation","primitive":"generation.call","name":"ai-sdk","startedAt":"2026-07-01T12:00:02.660Z","status":"ok","provider":"ai-sdk","attributes":{"adapterPackage":"@use-crux/ai"}}`,
		// Secondary direct-runtime evidence for an Eval scorer (scoring.judge span).
		`{"schemaVersion":2,"recordId":"cf_h_judge","type":"span","runId":"run_cf_healthy","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_cf_b","segmentSeq":7,"spanId":"sp_cf_judge","family":"scoring","primitive":"scoring.judge","name":"judge","startedAt":"2026-07-01T12:00:02.700Z","status":"ok","definitionRefs":[{"id":"scorer:connected","kind":"scorer","role":"invoked-scorer"}]}`,
	)

	// Runtime-observed/unjoined kinds must remain visible in Run Detail while
	// carrying no DefinitionRef that could fabricate per-definition activity.
	unjoinedPrimitives := make(map[string]struct{})
	segmentSeq := 8
	for _, entry := range fixture.Cases {
		if entry.ExpectedTreatment != "runtime-unjoined" {
			continue
		}
		if entry.DefinitionRef != nil {
			t.Fatalf("runtime-unjoined treatment for %s fabricated a ref: %+v", entry.Kind, entry.DefinitionRef)
		}
		if len(entry.RuntimePrimitiveNames) == 0 {
			t.Fatalf("runtime-unjoined treatment for %s has no primitives", entry.Kind)
		}
		for _, primitive := range entry.RuntimePrimitiveNames {
			family, ok := primitiveFamilyByName[primitive]
			if !ok {
				t.Fatalf("runtime-unjoined kind %s declares unknown primitive %q", entry.Kind, primitive)
			}
			mustIngest(t, service, fmt.Sprintf(
				`{"schemaVersion":2,"recordId":"cf_h_unjoined_%d","type":"span","runId":"run_cf_healthy","traceId":%q,"segmentId":"seg_cf_b","segmentSeq":%d,"spanId":"sp_cf_unjoined_%d","family":%q,"primitive":%q,"name":"connected unjoined evidence","startedAt":"2026-07-01T12:00:02.800Z","status":"ok"}`,
				segmentSeq, traceHealthy, segmentSeq, segmentSeq, family, primitive,
			))
			unjoinedPrimitives[primitive] = struct{}{}
			segmentSeq++
		}
	}
	mustIngest(t, service, fmt.Sprintf(
		`{"schemaVersion":2,"recordId":"cf_h_end","type":"run:end","runId":"run_cf_healthy","traceId":%q,"segmentId":"seg_cf_b","segmentSeq":%d,"endedAt":"2026-07-01T12:00:03.000Z","durationMs":3000,"status":"ok"}`,
		traceHealthy, segmentSeq,
	))

	// ── 2. Deliberately degraded sibling run (record-id conflict → ingest_health) ─
	mustIngest(t, service,
		runStartWithRefsJSON("cf_d_start", "run_cf_degraded", "seg_cf_d", 1, "2026-07-01T13:00:00.000Z",
			definitionRefJSON("agent:connected", "agent", "invoked-agent")),
	)
	conflict := mustBatch(t, `{"schemaVersion":2,"recordId":"cf_d_start","type":"run:start","runId":"run_cf_degraded","segmentId":"seg_cf_d","segmentSeq":1,"name":"different payload","rootPrimitive":"agent.run","startedAt":"2026-07-01T13:00:00.000Z","status":"running","definitionRefs":[{"id":"agent:connected","kind":"agent","role":"invoked-agent"}]}`)
	if err := service.Ingest(ctx, conflict); err == nil {
		t.Fatal("expected record identity conflict to degrade delivery health")
	}

	// ── 3. Activity: every connected definition has ≥1 run ───────────────────
	for _, entry := range fixture.Cases {
		if entry.DefinitionRef == nil {
			if entry.ExpectedTreatment == "runtime-unjoined" {
				summary, err := service.DefinitionActivitySummary(ctx, entry.Kind+":connected")
				if err != nil {
					t.Fatalf("zero activity summary for %s: %v", entry.Kind, err)
				}
				if summary.RunCount != 0 || summary.LastRun != nil {
					t.Fatalf("runtime-unjoined kind %s fabricated definition activity: %+v", entry.Kind, summary)
				}
			}
			continue
		}
		summary, err := service.DefinitionActivitySummary(ctx, entry.DefinitionRef.ID)
		if err != nil {
			t.Fatalf("activity summary for %s: %v", entry.DefinitionRef.ID, err)
		}
		if summary.RunCount < 1 {
			t.Fatalf("definition %s: expected runCount ≥ 1, got %+v", entry.DefinitionRef.ID, summary)
		}
	}

	// ── 4. Filtered Runs by definition (Catalog View Runs) ───────────────────
	page, err := service.RunsPage(ctx, RunListOptions{DefinitionID: "agent:connected"})
	if err != nil {
		t.Fatalf("filtered runs: %v", err)
	}
	if len(page.Rows) < 2 {
		t.Fatalf("agent:connected should touch healthy+degraded runs, got %d rows", len(page.Rows))
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
	if len(detail.DefinitionRefs) < len(refs) {
		t.Fatalf("run detail refs = %d, want ≥ %d", len(detail.DefinitionRefs), len(refs))
	}
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	for _, adapter := range fixture.Adapters {
		if !containsJSONText(detailJSON, adapter) {
			t.Fatalf("run detail does not retain adapter evidence for %q", adapter)
		}
	}
	graph, err := service.Graph(ctx, "run_cf_healthy")
	if err != nil {
		t.Fatalf("load connected graph: %v", err)
	}
	observedPrimitives := make(map[string]struct{}, len(graph.Spans))
	for _, span := range graph.Spans {
		observedPrimitives[span.Primitive] = struct{}{}
	}
	for primitive := range unjoinedPrimitives {
		if _, ok := observedPrimitives[primitive]; !ok {
			t.Fatalf("runtime-unjoined primitive %q is absent from Run Detail graph", primitive)
		}
	}

	// ── 7. Revision catch-up: current revision is a no-op delta ───────────────
	catchup, err := service.RunsSince(ctx, revisionAfterIngest)
	if err != nil {
		t.Fatalf("RunsSince current: %v", err)
	}
	if catchup.Expired {
		t.Fatalf("fresh revision %d must not expire: %#v", revisionAfterIngest, catchup)
	}

	// ── 8. Eval-correlation sibling: eval.case run does not pollute definition filters
	mustIngest(t, service,
		`{"schemaVersion":2,"recordId":"cf_eval_start","type":"run:start","runId":"run_cf_eval","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_cf_eval","segmentSeq":1,"name":"eval case","rootPrimitive":"eval.case","startedAt":"2026-07-01T14:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"cf_eval_end","type":"run:end","runId":"run_cf_eval","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_cf_eval","segmentSeq":2,"endedAt":"2026-07-01T14:00:01.000Z","status":"ok"}`,
	)
	afterEval, err := service.RunsPage(ctx, RunListOptions{DefinitionID: "prompt:connected"})
	if err != nil {
		t.Fatalf("filtered after eval: %v", err)
	}
	for _, row := range afterEval.Rows {
		if row.RunID == "run_cf_eval" {
			t.Fatal("Eval-only eval.case run must not appear under a definition filter")
		}
	}
	if afterEval.Revision <= revisionAfterIngest {
		t.Fatalf("revision must advance after eval ingest: before=%d after=%d", revisionAfterIngest, afterEval.Revision)
	}
}

func containsJSONText(raw []byte, value string) bool {
	quoted, _ := json.Marshal(value)
	return bytes.Contains(raw, quoted)
}
