package quality

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCellEvidenceAPIIncludesFailedAssertionSourceFrameAndValues(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTCELLEVIDENCE000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCELLEVIDENCE000000000",
  "evaluationId": "evals.evidence",
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
    "scores": { "citation_valid": { "mean": 0.58, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 1000, "p95Ms": 1000 },
    "costUsd": 0.05
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cases": [{
    "caseId": "case-1",
    "caseName": "refund policy",
    "variantName": "candidate",
    "trial": 0,
    "status": "failed",
    "input": { "q": "refund?", "apiKey": "[redacted]" },
    "output": "Refunds are available for 60 days...[truncated]",
    "expected": { "days": 30 },
    "scores": [{
      "name": "citation_valid",
      "score": 0.58,
      "label": "weak",
      "costClass": "judge",
      "metadata": { "rationale": "citation misses the policy window", "model": "judge-lite" }
    }],
    "assertions": {
      "ran": 1,
      "notEvaluated": 0,
      "failures": [{
        "level": "evaluation",
        "index": 0,
        "matcher": "toBeGreaterThanOrEqual",
        "soft": false,
        "message": "expected citation_valid to be >= 0.7",
        "expectedPreview": "0.7",
        "actualPreview": "0.58",
        "sourceRef": "evals/refunds.eval.ts:42:7"
      }],
      "outcomes": [{
        "id": "assert-0",
        "level": "evaluation",
        "phase": "assert",
        "index": 0,
        "status": "failed",
        "matcher": "toBeGreaterThanOrEqual",
        "soft": false,
        "message": "expected citation_valid to be >= 0.7",
        "actual": { "label": "actual", "value": 0.58, "preview": "0.58", "redacted": false },
        "expected": { "label": "expected", "value": 0.7, "preview": "0.7", "redacted": false },
        "expression": {
          "left": { "label": "actual", "value": 0.58, "preview": "0.58", "redacted": false },
          "operator": ">=",
          "right": { "label": "expected", "value": 0.7, "preview": "0.7", "redacted": false },
          "result": false,
          "rendered": "0.58 >= 0.7 => false"
        },
        "sourceRef": "evals/refunds.eval.ts:42:7",
        "assertionSiteId": "site-refunds-42",
        "sourceFrame": {
          "kind": "source-frame",
          "sourceRef": "evals/refunds.eval.ts:42:7",
          "authoredFile": "/workspace/evals/refunds.eval.ts",
          "authoredLine": 42,
          "authoredColumn": 7,
          "frameStartLine": 40,
          "frameEndLine": 43,
          "lines": [
            { "line": 40, "text": "score: citationScorer,", "role": "context" },
            { "line": 42, "text": "ctx.expect(ctx.score.citation_valid).toBeGreaterThanOrEqual(0.7)", "role": "failed" }
          ],
          "contentHash": "sha256:abc",
          "capturedAt": "2026-06-14T12:00:00.500Z",
          "stale": false,
          "resolver": "source-map"
        }
      }]
    },
    "durationMs": 1000,
    "costUsd": 0.05,
    "usage": { "inputTokens": 120, "outputTokens": 40 },
    "traceIds": ["trace-1"],
    "capturedSignals": ["steps"],
    "metadata": { "truncated": true }
  }]
}`)

	svc := NewService(store.NewStore(), dir)
	evidence, found, err := svc.CellEvidenceAPI(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTCELLEVIDENCE000000000",
		CaseID:       "case-1",
		VariantName:  "candidate",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}

	if evidence.Tag != "QualityCellEvidence" || evidence.SchemaVersion != 1 {
		t.Fatalf("contract markers = %+v", evidence)
	}
	if evidence.ExperimentID != "01KTCELLEVIDENCE000000000" || evidence.EvaluationID != "evals.evidence" {
		t.Fatalf("identity = %+v", evidence)
	}
	if evidence.Cell.CaseID != "case-1" || evidence.Cell.CaseName != "refund policy" || evidence.Cell.Status != "failed" {
		t.Fatalf("cell identity = %+v", evidence.Cell)
	}
	if evidence.IO.OutputTruncated != true || evidence.IO.RedactionApplied != true {
		t.Fatalf("io flags = %+v", evidence.IO)
	}
	if len(evidence.Scores) != 1 || evidence.Scores[0].Name != "citation_valid" {
		t.Fatalf("scores = %+v", evidence.Scores)
	}
	if evidence.Scores[0].Rationale != "citation misses the policy window" {
		t.Fatalf("score rationale = %+v", evidence.Scores[0])
	}
	if evidence.Scores[0].Threshold == nil || evidence.Scores[0].Threshold.Value != 0.7 || evidence.Scores[0].Threshold.Source != "assertion" {
		t.Fatalf("score threshold = %+v", evidence.Scores[0].Threshold)
	}
	if len(evidence.Assertions.Outcomes) != 1 || evidence.Assertions.Outcomes[0].SourceFrame == nil {
		t.Fatalf("assertion outcomes = %+v", evidence.Assertions.Outcomes)
	}
	if evidence.Assertions.Outcomes[0].Expression == nil || evidence.Assertions.Outcomes[0].Expression.Rendered != "0.58 >= 0.7 => false" {
		t.Fatalf("assertion expression = %+v", evidence.Assertions.Outcomes[0].Expression)
	}
	if len(evidence.Checks) != 2 {
		t.Fatalf("checks = %+v", evidence.Checks)
	}
	if evidence.Checks[0].Kind != "assertion" || evidence.Checks[0].SourceFrame == nil {
		t.Fatalf("assertion check = %+v", evidence.Checks[0])
	}
	if evidence.Checks[1].Kind != "score-threshold" || evidence.Checks[1].ScoreName != "citation_valid" {
		t.Fatalf("score-threshold check = %+v", evidence.Checks[1])
	}
	if evidence.Code.PrimaryFrame.Kind != "source-frame" || evidence.Code.OpenedInEditor == nil {
		t.Fatalf("code evidence = %+v", evidence.Code)
	}
	if !hasEvidenceValue(evidence.Code.ValuesAtCheck, "score.citation_valid") {
		t.Fatalf("values at check missing score: %+v", evidence.Code.ValuesAtCheck)
	}
	if evidence.Trace.TraceIDs[0] != "trace-1" || evidence.Baseline.Kind != "unavailable" || evidence.Baseline.Reason != "no-baseline" {
		t.Fatalf("trace/baseline = %+v / %+v", evidence.Trace, evidence.Baseline)
	}
}

func TestCellEvidenceAPIIncludesRuntimeErrorCheck(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTCELLERROR000000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCELLERROR000000000000",
  "evaluationId": "evals.error",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": 0, "failed": 0, "errored": 1, "skipped": 0, "passRate": 0,
    "scores": {}, "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cases": [{
    "caseId": "case-error",
    "variantName": "default",
    "trial": 0,
    "status": "errored",
    "input": { "q": "boom" },
    "scores": [],
    "assertions": { "ran": 0, "notEvaluated": 0, "failures": [] },
    "error": { "message": "model call failed", "phase": "execute" },
    "durationMs": 1000,
    "traceIds": ["trace-error"],
    "capturedSignals": []
  }]
}`)

	svc := NewService(store.NewStore(), dir)
	evidence, found, err := svc.CellEvidenceAPI(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTCELLERROR000000000000",
		CaseID:       "case-error",
		VariantName:  "default",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if evidence.Cell.Error == nil || evidence.Cell.Error.Phase != "execute" {
		t.Fatalf("cell error = %+v", evidence.Cell.Error)
	}
	if len(evidence.Checks) != 1 || evidence.Checks[0].Kind != "runtime-error" {
		t.Fatalf("checks = %+v", evidence.Checks)
	}
	if evidence.Checks[0].Phase != "execute" || evidence.Checks[0].Message != "model call failed" {
		t.Fatalf("runtime error check = %+v", evidence.Checks[0])
	}
	if evidence.Code.PrimaryFrame.Kind != "unavailable" || evidence.Code.PrimaryFrame.Reason != "no-source-ref" {
		t.Fatalf("primary frame = %+v", evidence.Code.PrimaryFrame)
	}
	if evidence.TrialSummary.Verdict != "all-errored" {
		t.Fatalf("trial summary = %+v", evidence.TrialSummary)
	}
}

func TestCellEvidenceAPIBuildsFlakyTrialSummary(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTCELLFLAKY00000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCELLFLAKY00000000000",
  "evaluationId": "evals.flaky",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:03.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 3, "passed": 2, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0.667,
    "scores": { "helpful": { "mean": 0.7, "sem": 0.1, "n": 3 } },
    "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cases": [
    {
      "caseId": "case-flaky", "variantName": "default", "trial": 0, "status": "passed",
      "input": { "q": "same" }, "output": "ok",
      "scores": [{ "name": "helpful", "score": 0.9 }],
      "assertions": { "ran": 1, "notEvaluated": 0, "failures": [], "outcomes": [{ "id": "ok-0", "level": "evaluation", "phase": "expect", "index": 0, "status": "passed", "matcher": "toBe", "soft": false }] },
      "durationMs": 900, "traceIds": [], "capturedSignals": []
    },
    {
      "caseId": "case-flaky", "variantName": "default", "trial": 1, "status": "failed",
      "input": { "q": "same" }, "output": "bad",
      "scores": [{ "name": "helpful", "score": 0.3 }],
      "assertions": { "ran": 1, "notEvaluated": 0, "failures": [{ "level": "evaluation", "index": 0, "matcher": "toBe", "soft": false, "message": "expected ok", "actualPreview": "bad", "expectedPreview": "ok" }] },
      "durationMs": 1200, "traceIds": [], "capturedSignals": []
    },
    {
      "caseId": "case-flaky", "variantName": "default", "trial": 2, "status": "passed",
      "input": { "q": "same" }, "output": "ok",
      "scores": [{ "name": "helpful", "score": 0.9 }],
      "assertions": { "ran": 1, "notEvaluated": 0, "failures": [] },
      "durationMs": 1000, "traceIds": [], "capturedSignals": []
    }
  ]
}`)

	svc := NewService(store.NewStore(), dir)
	evidence, found, err := svc.CellEvidenceAPI(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTCELLFLAKY00000000000",
		CaseID:       "case-flaky",
		VariantName:  "default",
		Trial:        1,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	summary := evidence.TrialSummary
	if summary.Total != 3 || summary.Passed != 2 || summary.Failed != 1 || summary.Verdict != "flaky" {
		t.Fatalf("trial summary = %+v", summary)
	}
	if len(summary.Trials) != 3 || summary.Trials[1].Trial != 1 || summary.Trials[1].PrimaryFailure != "expected ok" {
		t.Fatalf("trial rows = %+v", summary.Trials)
	}
}

func TestCellEvidenceAPISynthesizesLegacyFailureOutcomes(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTCELLLEGACY0000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCELLLEGACY0000000000",
  "evaluationId": "evals.legacy",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0,
    "scores": {}, "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cases": [{
    "caseId": "case-legacy",
    "variantName": "default",
    "trial": 0,
    "status": "failed",
    "input": { "q": "legacy" },
    "output": "bad",
    "scores": [],
    "assertions": {
      "ran": 1,
      "notEvaluated": 2,
      "failures": [{
        "level": "case",
        "index": 0,
        "matcher": "toContain",
        "soft": false,
        "message": "expected output to contain policy",
        "actualPreview": "bad",
        "expectedPreview": "policy",
        "sourceRef": "evals/legacy.eval.ts:9:3"
      }]
    },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)

	svc := NewService(store.NewStore(), dir)
	evidence, found, err := svc.CellEvidenceAPI(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTCELLLEGACY0000000000",
		CaseID:       "case-legacy",
		VariantName:  "default",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if evidence.Assertions.Ran != 1 || evidence.Assertions.NotEvaluated != 2 {
		t.Fatalf("assertion counters = %+v", evidence.Assertions)
	}
	if len(evidence.Assertions.Outcomes) != 1 {
		t.Fatalf("outcomes = %+v", evidence.Assertions.Outcomes)
	}
	outcome := evidence.Assertions.Outcomes[0]
	if outcome.ID != "legacy-failure-0" || outcome.Status != "failed" || outcome.SourceRef != "evals/legacy.eval.ts:9:3" {
		t.Fatalf("legacy outcome = %+v", outcome)
	}
	if outcome.Actual == nil || outcome.Actual.Preview != "bad" || outcome.Expected == nil || outcome.Expected.Preview != "policy" {
		t.Fatalf("legacy previews = actual %+v expected %+v", outcome.Actual, outcome.Expected)
	}
	if len(evidence.Checks) != 1 || evidence.Checks[0].Kind != "assertion" {
		t.Fatalf("checks = %+v", evidence.Checks)
	}
	if evidence.Code.PrimaryFrame.Kind != "unavailable" || evidence.Code.PrimaryFrame.Reason != "source-map-missing" {
		t.Fatalf("primary frame = %+v", evidence.Code.PrimaryFrame)
	}
}

func hasEvidenceValue(values []api.QualityEvidenceValue, label string) bool {
	for _, value := range values {
		if value.Label == label {
			return true
		}
	}
	return false
}
