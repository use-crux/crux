package quality

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCellEvidenceAPIUsesExactAssertionSpanEvidence(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "trace-exact.json", `{
  "schemaVersion": 1,
  "experimentId": "trace-exact",
  "evaluationId": "evals.trace",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "candidate", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "candidate": {
    "cells": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0,
    "scores": {}, "latency": { "meanMs": 120, "p95Ms": 120 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cases": [{
    "caseId": "case-1",
    "caseName": "refund policy",
    "variantName": "candidate",
    "trial": 0,
    "status": "failed",
    "input": { "q": "refund?" },
    "output": "Refunds are available for 60 days.",
    "scores": [],
    "assertions": {
      "ran": 1,
      "notEvaluated": 0,
      "failures": [],
      "outcomes": [{
        "id": "assert-0",
        "level": "evaluation",
        "phase": "expect",
        "index": 0,
        "status": "failed",
        "matcher": "steps.toHaveSucceeded",
        "soft": false,
        "message": "expected step 'draft' to have succeeded, but it failed",
        "spanIds": ["span_trace_exact_draft"]
      }]
    },
    "durationMs": 120,
    "traceIds": ["run_trace_exact"],
    "capturedSignals": ["steps"]
  }]
}`)
	obs := openTraceEvidenceObservability(t, ctx, `{"records":[
		{"schemaVersion":1,"recordId":"run-start-exact","type":"run:start","runId":"run_trace_exact","traceId":"trace_exact","name":"draft check","rootPrimitive":"flow.run","startedAt":"2026-06-14T12:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"span-root-exact","type":"span","runId":"run_trace_exact","traceId":"trace_exact","spanId":"span_trace_exact_root","family":"flow","primitive":"flow.run","name":"draft check","startedAt":"2026-06-14T12:00:00.000Z","endedAt":"2026-06-14T12:00:00.120Z","durationMs":120,"status":"ok"},
		{"schemaVersion":1,"recordId":"span-draft-exact","type":"span","runId":"run_trace_exact","traceId":"trace_exact","spanId":"span_trace_exact_draft","parentSpanId":"span_trace_exact_root","family":"flow","primitive":"flow.step","name":"draft","startedAt":"2026-06-14T12:00:00.010Z","endedAt":"2026-06-14T12:00:00.090Z","durationMs":80,"status":"error","attributes":{"stepLabel":"draft"}},
		{"schemaVersion":1,"recordId":"run-end-exact","type":"run:end","runId":"run_trace_exact","traceId":"trace_exact","endedAt":"2026-06-14T12:00:00.120Z","durationMs":120,"status":"ok"}
	]}`)
	defer obs.Close()

	svc := NewService(store.NewStore(), dir).WithObservability(obs)
	evidence, found, err := svc.CellEvidenceAPI(ctx, api.QualityCellEvidenceQuery{
		ExperimentID: "trace-exact",
		CaseID:       "case-1",
		VariantName:  "candidate",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}

	if got := evidence.Checks[0].SpanIDs; len(got) != 1 || got[0] != "span_trace_exact_draft" {
		t.Fatalf("check span ids = %#v", got)
	}
	if got := evidence.Trace.HotSpanIDs; len(got) != 1 || got[0] != "span_trace_exact_draft" {
		t.Fatalf("hot span ids = %#v", got)
	}
	if evidence.Trace.RootCause == nil || evidence.Trace.RootCause.SpanID != "span_trace_exact_draft" || evidence.Trace.RootCause.Confidence != "exact" {
		t.Fatalf("root cause = %#v", evidence.Trace.RootCause)
	}
	if !hasHotTraceSpan(evidence.Trace.Spans, "span_trace_exact_draft") {
		t.Fatalf("trace spans = %#v", evidence.Trace.Spans)
	}
}

func TestCellEvidenceAPIUsesScoreThresholdTraceHeuristic(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "trace-heuristic.json", `{
  "schemaVersion": 1,
  "experimentId": "trace-heuristic",
  "evaluationId": "evals.trace",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "candidate", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "candidate": {
    "cells": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0,
    "scores": { "helpful": { "mean": 0.4, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 160, "p95Ms": 160 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cases": [{
    "caseId": "case-1",
    "caseName": "refund policy",
    "variantName": "candidate",
    "trial": 0,
    "status": "failed",
    "input": { "q": "refund?" },
    "output": "Refunds are available for 60 days.",
    "scores": [{ "name": "helpful", "score": 0.4, "metadata": { "rationale": "missing refund policy" } }],
    "assertions": {
      "ran": 1,
      "notEvaluated": 0,
      "failures": [],
      "outcomes": [{
        "id": "assert-score",
        "level": "evaluation",
        "phase": "assert",
        "index": 0,
        "status": "failed",
        "matcher": "toBeGreaterThanOrEqual",
        "soft": false,
        "message": "expected helpful to be >= 0.8",
        "actual": { "label": "actual", "value": 0.4, "preview": "0.4", "redacted": false },
        "expected": { "label": "expected", "value": 0.8, "preview": "0.8", "redacted": false },
        "expression": {
          "left": { "label": "actual", "value": 0.4, "preview": "0.4", "redacted": false },
          "operator": ">=",
          "right": { "label": "expected", "value": 0.8, "preview": "0.8", "redacted": false },
          "result": false,
          "rendered": "0.4 >= 0.8 => false"
        }
      }]
    },
    "durationMs": 160,
    "traceIds": ["run_trace_heuristic"],
    "capturedSignals": ["modelCalls"]
  }]
}`)
	obs := openTraceEvidenceObservability(t, ctx, `{"records":[
		{"schemaVersion":1,"recordId":"run-start-heuristic","type":"run:start","runId":"run_trace_heuristic","traceId":"trace_heuristic","name":"score check","rootPrimitive":"flow.run","startedAt":"2026-06-14T12:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"span-root-heuristic","type":"span","runId":"run_trace_heuristic","traceId":"trace_heuristic","spanId":"span_trace_heuristic_root","family":"flow","primitive":"flow.run","name":"score check","startedAt":"2026-06-14T12:00:00.000Z","endedAt":"2026-06-14T12:00:00.160Z","durationMs":160,"status":"ok"},
		{"schemaVersion":1,"recordId":"span-score-heuristic","type":"span","runId":"run_trace_heuristic","traceId":"trace_heuristic","spanId":"span_trace_heuristic_score","parentSpanId":"span_trace_heuristic_root","family":"scoring","primitive":"scoring.judge","name":"helpful judge","startedAt":"2026-06-14T12:00:00.090Z","endedAt":"2026-06-14T12:00:00.150Z","durationMs":60,"status":"ok"},
		{"schemaVersion":1,"recordId":"run-end-heuristic","type":"run:end","runId":"run_trace_heuristic","traceId":"trace_heuristic","endedAt":"2026-06-14T12:00:00.160Z","durationMs":160,"status":"ok"}
	]}`)
	defer obs.Close()

	svc := NewService(store.NewStore(), dir).WithObservability(obs)
	evidence, found, err := svc.CellEvidenceAPI(ctx, api.QualityCellEvidenceQuery{
		ExperimentID: "trace-heuristic",
		CaseID:       "case-1",
		VariantName:  "candidate",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}

	if got := evidence.Trace.HotSpanIDs; len(got) != 1 || got[0] != "span_trace_heuristic_score" {
		t.Fatalf("hot span ids = %#v spans = %#v", got, evidence.Trace.Spans)
	}
	if evidence.Trace.RootCause == nil || evidence.Trace.RootCause.SpanID != "span_trace_heuristic_score" || evidence.Trace.RootCause.Confidence != "heuristic" {
		t.Fatalf("root cause = %#v", evidence.Trace.RootCause)
	}
	if !hasHotTraceSpan(evidence.Trace.Spans, "span_trace_heuristic_score") {
		t.Fatalf("trace spans = %#v", evidence.Trace.Spans)
	}
}

func openTraceEvidenceObservability(t *testing.T, ctx context.Context, raw string) *observability.Service {
	t.Helper()
	obs, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	var batch observability.Batch
	if err := json.Unmarshal([]byte(raw), &batch); err != nil {
		t.Fatal(err)
	}
	if err := obs.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	return obs
}

func hasHotTraceSpan(spans []api.QualityTraceSpanEvidence, spanID string) bool {
	for _, span := range spans {
		if span.SpanID == spanID && span.Hot {
			return true
		}
	}
	return false
}
