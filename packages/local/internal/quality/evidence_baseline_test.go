package quality

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCellEvidenceAPIOldScoreOnlyBaselineDegradesHonestly(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTCELLBASEOLD000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCELLBASEOLD000000000",
  "evaluationId": "evals.baseline",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "baselineRef": {
    "baselineId": "01KTBASEOLD",
    "experimentId": "01KTMISSINGBASELINE",
    "variantName": "candidate"
  },
  "variants": [{ "name": "candidate", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "candidate": {
    "cells": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0,
    "scores": { "helpful": { "mean": 0.58, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cells": [{
    "caseId": "case-baseline",
    "variantName": "candidate",
    "trial": 0,
    "status": "failed",
    "input": { "q": "refund window" },
    "output": "Refunds are available for 60 days",
    "scores": [{ "name": "helpful", "score": 0.58 }],
    "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)
	writeSpecFixture(t, dir, "baselines", "evals.baseline.json", `{
  "schemaVersion": 1,
  "baselineId": "01KTBASEOLD",
  "evaluationId": "evals.baseline",
  "experimentId": "01KTMISSINGBASELINE",
  "variantName": "candidate",
  "promotedAt": "2026-06-14T11:00:00.000Z",
  "configFingerprint": "cf-baseline",
  "reference": { "case-baseline": { "helpful": 0.8 } }
}`)

	svc := NewService(store.NewStore(), dir)
	evidence, found, err := svc.CellEvidenceAPI(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTCELLBASEOLD000000000",
		CaseID:       "case-baseline",
		VariantName:  "candidate",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if evidence.Baseline.Kind != "unavailable" {
		t.Fatalf("baseline kind = %+v", evidence.Baseline)
	}
	if evidence.Baseline.BaselineID != "01KTBASEOLD" || evidence.Baseline.ExperimentID != "01KTMISSINGBASELINE" {
		t.Fatalf("baseline identity = %+v", evidence.Baseline)
	}
	if evidence.Baseline.Reason != "baseline-has-no-output-evidence" {
		t.Fatalf("baseline reason = %+v", evidence.Baseline)
	}
}

func TestCellEvidenceAPIUsesBaselineSourceExperimentEvidence(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTCELLBASENEW000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCELLBASENEW000000000",
  "evaluationId": "evals.baseline-source",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf-candidate",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "baselineRef": {
    "baselineId": "01KTBASESOURCE",
    "experimentId": "01KTBASESOURCEEXP000000",
    "variantName": "baseline"
  },
  "variants": [{ "name": "candidate", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "candidate": {
    "cells": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0,
    "scores": { "helpful": { "mean": 0.58, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cells": [{
    "caseId": "case-baseline",
    "variantName": "candidate",
    "trial": 0,
    "status": "failed",
    "input": { "q": "refund window", "secret": "[redacted]" },
    "output": "Refunds are available for 60 days",
    "scores": [{ "name": "helpful", "score": 0.58, "metadata": { "rationale": "too long" } }],
    "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)
	writeSpecFixture(t, dir, "experiments", "01KTBASESOURCEEXP000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTBASESOURCEEXP000000",
  "evaluationId": "evals.baseline-source",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T11:00:00.000Z",
  "endedAt": "2026-06-14T11:00:01.000Z",
  "configFingerprint": "cf-baseline",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "baseline", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "baseline": {
    "cells": 1, "passed": 1, "failed": 0, "errored": 0, "skipped": 0, "passRate": 1,
    "scores": { "helpful": { "mean": 0.8, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": true, "informational": false, "results": [] },
  "passed": true,
  "cells": [{
    "caseId": "case-baseline",
    "variantName": "baseline",
    "trial": 0,
    "status": "passed",
    "input": { "q": "refund window", "secret": "[redacted]" },
    "output": "Refunds are available for 30 days",
    "scores": [{ "name": "helpful", "score": 0.8, "metadata": { "rationale": "matches policy" } }],
    "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)
	writeSpecFixture(t, dir, "baselines", "evals.baseline-source.json", `{
  "schemaVersion": 1,
  "baselineId": "01KTBASESOURCE",
  "evaluationId": "evals.baseline-source",
  "experimentId": "01KTBASESOURCEEXP000000",
  "variantName": "baseline",
  "promotedAt": "2026-06-14T11:05:00.000Z",
  "configFingerprint": "cf-baseline",
  "reference": { "case-baseline": { "helpful": 0.8 } }
}`)

	svc := NewService(store.NewStore(), dir)
	evidence, found, err := svc.CellEvidenceAPI(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTCELLBASENEW000000000",
		CaseID:       "case-baseline",
		VariantName:  "candidate",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if evidence.Baseline.Kind != "available" {
		t.Fatalf("baseline = %+v", evidence.Baseline)
	}
	if evidence.Baseline.SameInput == nil || !*evidence.Baseline.SameInput || evidence.Baseline.SameCase == nil || !*evidence.Baseline.SameCase {
		t.Fatalf("baseline comparability = %+v", evidence.Baseline)
	}
	if evidence.Baseline.BaselineCell == nil || evidence.Baseline.BaselineCell.Output != "Refunds are available for 30 days" {
		t.Fatalf("baseline cell = %+v", evidence.Baseline.BaselineCell)
	}
	if len(evidence.Baseline.BaselineCell.Scores) != 1 || evidence.Baseline.BaselineCell.Scores[0].Rationale != "matches policy" {
		t.Fatalf("baseline scores = %+v", evidence.Baseline.BaselineCell.Scores)
	}
	if len(evidence.Baseline.Deltas) != 1 || evidence.Baseline.Deltas[0].Delta != -0.22 {
		t.Fatalf("baseline deltas = %+v", evidence.Baseline.Deltas)
	}
	if len(evidence.Scores) != 1 || evidence.Scores[0].DeltaFromBaseline == nil || *evidence.Scores[0].DeltaFromBaseline != -0.22 {
		t.Fatalf("candidate score delta = %+v", evidence.Scores)
	}
}
