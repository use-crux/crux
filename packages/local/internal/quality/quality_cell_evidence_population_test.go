package quality

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCellEvidenceAPIIncludesPassingAssertionChecksAndGateScoreFloors(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTCELLPOPULATION000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCELLPOPULATION000000",
  "evaluationId": "evals.population",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": 1, "failed": 0, "errored": 0, "skipped": 0, "passRate": 1,
    "scores": { "helpful": { "mean": 0.62, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": {
    "passed": false,
    "informational": false,
    "results": [{
      "gate": "scores.helpful.min",
      "variantName": "default",
      "threshold": 0.7,
      "actual": 0.62,
      "passed": false
    }]
  },
  "passed": false,
  "cases": [{
    "caseId": "case-populated",
    "caseName": "score floor",
    "variantName": "default",
    "trial": 0,
    "status": "passed",
    "input": { "q": "explain policy" },
    "output": "short answer",
    "scores": [{
      "name": "helpful",
      "score": 0.62,
      "label": "weak",
      "costClass": "judge",
      "metadata": { "rationale": "answer is too terse to be useful" }
    }],
    "assertions": {
      "ran": 1,
      "notEvaluated": 0,
      "failures": [],
      "outcomes": [{
        "id": "assert-0",
        "level": "evaluation",
        "phase": "assert",
        "index": 0,
	        "status": "passed",
	        "matcher": "toContain",
	        "subjectExpr": "ctx.output",
	        "soft": false,
	        "message": "expected output to include policy",
        "expression": {
          "left": { "label": "actual", "value": "short answer", "preview": "short answer", "redacted": false },
          "operator": "contains",
          "right": { "label": "expected", "value": "answer", "preview": "answer", "redacted": false },
          "result": true,
          "rendered": "\"short answer\" contains \"answer\" => true"
        },
        "sourceRef": "evals/population.eval.ts:15:5",
        "sourceFrame": {
          "kind": "source-frame",
          "sourceRef": "evals/population.eval.ts:15:5",
          "authoredFile": "/workspace/evals/population.eval.ts",
          "authoredLine": 15,
          "authoredColumn": 5,
          "frameStartLine": 13,
          "frameEndLine": 16,
          "lines": [
            { "line": 13, "text": "expect: (ctx) => {", "role": "context" },
            { "line": 15, "text": "ctx.expect(ctx.output).toContain('answer')", "role": "passed" }
          ],
          "contentHash": "sha256:population",
          "capturedAt": "2026-06-14T12:00:00.500Z",
          "stale": false,
          "resolver": "source-map"
        }
      }]
    },
    "durationMs": 1000,
    "traceIds": ["trace-populated"],
    "capturedSignals": []
  }]
}`)

	svc := NewService(store.NewStore(), dir)
	evidence, found, err := svc.CellEvidenceAPI(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTCELLPOPULATION000000",
		CaseID:       "case-populated",
		VariantName:  "default",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}

	if len(evidence.Assertions.Outcomes) != 1 || evidence.Assertions.Outcomes[0].Status != "passed" {
		t.Fatalf("assertion outcomes = %+v", evidence.Assertions.Outcomes)
	}
	if len(evidence.Checks) != 2 {
		t.Fatalf("checks = %+v", evidence.Checks)
	}
	if evidence.Checks[0].Kind != "assertion" || evidence.Checks[0].Status != "passed" || evidence.Checks[0].SourceFrame == nil {
		t.Fatalf("passing assertion check = %+v", evidence.Checks[0])
	}
	if evidence.Checks[0].Message != "expected output to include policy" {
		t.Fatalf("passing assertion check message = %+v", evidence.Checks[0])
	}
	if evidence.Checks[1].Kind != "score-threshold" || evidence.Checks[1].ScoreName != "helpful" {
		t.Fatalf("score threshold check = %+v", evidence.Checks[1])
	}
	if evidence.Checks[1].Message != "0.62 is below the 0.70 floor" {
		t.Fatalf("score threshold message = %+v", evidence.Checks[1])
	}
	if evidence.Checks[1].Score == nil || *evidence.Checks[1].Score != 0.62 {
		t.Fatalf("score threshold score = %+v", evidence.Checks[1].Score)
	}
	if evidence.Checks[1].Threshold == nil || *evidence.Checks[1].Threshold != 0.7 || evidence.Checks[1].Passed == nil || *evidence.Checks[1].Passed != false {
		t.Fatalf("score threshold comparison = %+v", evidence.Checks[1])
	}
	if evidence.Checks[1].Source != "gate" || evidence.Checks[1].Operator != ">=" || evidence.Checks[1].Rationale != "answer is too terse to be useful" {
		t.Fatalf("score threshold provenance = %+v", evidence.Checks[1])
	}
	if len(evidence.Scores) != 1 || evidence.Scores[0].Threshold == nil {
		t.Fatalf("scores = %+v", evidence.Scores)
	}
	if evidence.Scores[0].Threshold.Source != "gate" || evidence.Scores[0].Threshold.Value != 0.7 || evidence.Scores[0].Threshold.Passed != false {
		t.Fatalf("score threshold = %+v", evidence.Scores[0].Threshold)
	}
	if evidence.Scores[0].Rationale != "answer is too terse to be useful" {
		t.Fatalf("score rationale = %+v", evidence.Scores[0])
	}
	if evidence.Code.PrimaryFrame.Kind != "source-frame" || evidence.Code.PrimaryFrame.AuthoredLine != 15 {
		t.Fatalf("primary frame = %+v", evidence.Code.PrimaryFrame)
	}
	if !hasEvidenceValue(evidence.Code.ValuesAtCheck, "threshold.helpful") {
		t.Fatalf("values at check missing threshold: %+v", evidence.Code.ValuesAtCheck)
	}
}
