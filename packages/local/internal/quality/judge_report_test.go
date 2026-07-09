package quality

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestJudgeReportAPIComputesAgreementAndConfusion(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTJUDGEREPORT000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTJUDGEREPORT000000000",
  "evaluationId": "evals.judge-report",
  "qualityId": "local",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 2, "passed": 1, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0.5,
    "scores": { "helpful": { "mean": 0.73, "sem": 0.03, "n": 2 } },
    "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [
    { "gate": "scores.helpful.min", "threshold": 0.7, "actual": 0.73, "passed": true }
  ] },
  "passed": false,
  "cells": [{
    "caseId": "case-pass",
    "variantName": "default",
    "trial": 0,
    "status": "passed",
    "input": {},
    "output": "good",
    "scores": [{ "name": "helpful", "score": 0.9, "costClass": "model", "metadata": {
      "rationale": "clearly helpful",
      "judge": { "model": "judge-model", "promptVersion": 1, "rubricFingerprint": "abc" }
    } }],
    "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }, {
    "caseId": "case-fail",
    "variantName": "default",
    "trial": 0,
    "status": "failed",
    "input": {},
    "output": "bad",
    "scores": [{ "name": "helpful", "score": 0.8, "costClass": "model", "metadata": {
      "rationale": "too vague",
      "judge": { "model": "judge-model", "promptVersion": 1, "rubricFingerprint": "abc" }
    } }],
    "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)
	if _, err := qualityfs.Put(qualityfs.Open(dir), qualityfs.Feedback{
		ExperimentID: judgeReportStringPtr("01KTJUDGEREPORT000000000"),
		CaseID:       judgeReportStringPtr("case-pass"),
		Rating:       judgeReportIntPtr(1),
		Tags:         []string{"human-label"},
		Metadata:     map[string]any{"variant": "default", "trial": 0, "scoreName": "helpful"},
	}); err != nil {
		t.Fatalf("put pass label: %v", err)
	}
	if _, err := qualityfs.Put(qualityfs.Open(dir), qualityfs.Feedback{
		ExperimentID: judgeReportStringPtr("01KTJUDGEREPORT000000000"),
		CaseID:       judgeReportStringPtr("case-fail"),
		Rating:       judgeReportIntPtr(-1),
		Tags:         []string{"human-label"},
		Metadata:     map[string]any{"variant": "default", "trial": 0, "scoreName": "helpful"},
	}); err != nil {
		t.Fatalf("put fail label: %v", err)
	}

	report, found, err := NewService(store.NewStore(), dir).JudgeReportAPI(context.Background(), "evals.judge-report")
	if err != nil {
		t.Fatalf("JudgeReportAPI: %v", err)
	}
	if !found {
		t.Fatal("report not found")
	}
	if report.SchemaVersion != 1 || report.EvaluationID != "evals.judge-report" || len(report.Scorers) != 1 {
		t.Fatalf("report identity = %+v", report)
	}
	scorer := report.Scorers[0]
	if scorer.Name != "helpful" || scorer.Threshold != 0.7 || scorer.Labeled != 2 {
		t.Fatalf("scorer summary = %+v", scorer)
	}
	if scorer.Confusion.TP != 1 || scorer.Confusion.FP != 1 || scorer.Confusion.FN != 0 || scorer.Confusion.TN != 0 {
		t.Fatalf("confusion = %+v", scorer.Confusion)
	}
	if scorer.Agreement != 0.5 || scorer.Precision != 0.5 || scorer.Recall != 1 {
		t.Fatalf("rates = agreement %v precision %v recall %v", scorer.Agreement, scorer.Precision, scorer.Recall)
	}
	if len(scorer.Disagreements) != 1 || scorer.Disagreements[0].CaseID != "case-fail" || scorer.Disagreements[0].Human != "fail" {
		t.Fatalf("disagreements = %+v", scorer.Disagreements)
	}
}

func judgeReportStringPtr(value string) *string {
	return &value
}

func judgeReportIntPtr(value int) *int {
	return &value
}
