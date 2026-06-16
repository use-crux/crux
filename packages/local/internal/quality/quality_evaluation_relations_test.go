package quality

import (
	"context"
	"fmt"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestEvaluationExperimentsAPIOrdersLimitsAndReportsTotals(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTRELATIONOLD0000000000.json", qualityRelationExperimentRecord(
		"01KTRELATIONOLD0000000000",
		"evals.relations",
		"2026-06-14T10:00:00.000Z",
		"2026-06-14T10:00:02.000Z",
		true,
	))
	writeSpecFixture(t, dir, "experiments", "01KTRELATIONNEW0000000000.json", qualityRelationExperimentRecord(
		"01KTRELATIONNEW0000000000",
		"evals.relations",
		"2026-06-14T11:00:00.000Z",
		"2026-06-14T11:00:02.000Z",
		false,
	))
	writeSpecFixture(t, dir, "experiments", "01KTRELATIONOTHER00000000.json", qualityRelationExperimentRecord(
		"01KTRELATIONOTHER00000000",
		"evals.other",
		"2026-06-14T12:00:00.000Z",
		"2026-06-14T12:00:02.000Z",
		true,
	))

	svc := NewService(store.NewStore(), dir)
	relation, err := svc.EvaluationExperimentsAPI(context.Background(), "evals.relations", 1)
	if err != nil {
		t.Fatal(err)
	}
	if relation.Tag != "QualityEvaluationExperiments" || relation.SchemaVersion != 1 {
		t.Fatalf("contract markers = %+v", relation)
	}
	if relation.EvaluationID != "evals.relations" || relation.Total != 2 || relation.Limit != 1 {
		t.Fatalf("identity/counts = %+v", relation)
	}
	if len(relation.Experiments) != 1 {
		t.Fatalf("experiments length = %d, want 1: %+v", len(relation.Experiments), relation.Experiments)
	}
	if got := relation.Experiments[0]; got.ExperimentID != "01KTRELATIONNEW0000000000" || got.EvaluationID != "evals.relations" || got.Passed {
		t.Fatalf("newest limited summary = %+v", got)
	}

	empty, err := svc.EvaluationExperimentsAPI(context.Background(), "evals.missing", 10)
	if err != nil {
		t.Fatal(err)
	}
	if empty.Total != 0 || len(empty.Experiments) != 0 {
		t.Fatalf("empty relation = %+v", empty)
	}
}

func TestEvaluationExperimentGroupsAPIOrdersByLatestExperimentAndLimitsGroups(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTRELALPHAOLD000000000.json", qualityRelationExperimentRecord(
		"01KTRELALPHAOLD000000000",
		"evals.alpha",
		"2026-06-14T10:00:00.000Z",
		"2026-06-14T10:00:02.000Z",
		true,
	))
	writeSpecFixture(t, dir, "experiments", "01KTRELALPHANEW000000000.json", qualityRelationExperimentRecord(
		"01KTRELALPHANEW000000000",
		"evals.alpha",
		"2026-06-14T11:00:00.000Z",
		"2026-06-14T11:00:02.000Z",
		false,
	))
	writeSpecFixture(t, dir, "experiments", "01KTRELBETALATEST0000000.json", qualityRelationExperimentRecord(
		"01KTRELBETALATEST0000000",
		"evals.beta",
		"2026-06-14T12:00:00.000Z",
		"2026-06-14T12:00:02.000Z",
		true,
	))

	svc := NewService(store.NewStore(), dir)
	groups, err := svc.EvaluationExperimentGroupsAPI(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if groups.Tag != "QualityEvaluationExperimentGroups" || groups.SchemaVersion != 1 {
		t.Fatalf("contract markers = %+v", groups)
	}
	if groups.TotalEvaluations != 2 || groups.TotalExperiments != 3 || groups.Limit != 1 {
		t.Fatalf("totals = %+v", groups)
	}
	if len(groups.Groups) != 2 {
		t.Fatalf("groups length = %d, want 2: %+v", len(groups.Groups), groups.Groups)
	}
	if first := groups.Groups[0]; first.EvaluationID != "evals.beta" || first.Total != 1 || first.Experiments[0].ExperimentID != "01KTRELBETALATEST0000000" {
		t.Fatalf("first group = %+v", first)
	}
	if second := groups.Groups[1]; second.EvaluationID != "evals.alpha" || second.Total != 2 || len(second.Experiments) != 1 || second.Experiments[0].ExperimentID != "01KTRELALPHANEW000000000" {
		t.Fatalf("second group = %+v", second)
	}
}

func qualityRelationExperimentRecord(id, evaluationID, startedAt, endedAt string, passed bool) string {
	passedCells := 0
	failedCells := 1
	passRate := 0
	if passed {
		passedCells = 1
		failedCells = 0
		passRate = 1
	}
	return fmt.Sprintf(`{
  "schemaVersion": 1,
  "experimentId": %q,
  "evaluationId": %q,
  "qualityId": "@packages/backend",
  "startedAt": %q,
  "endedAt": %q,
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": %d, "failed": %d, "errored": 0, "skipped": 0, "passRate": %d,
    "scores": { "pass": { "mean": %d, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 1, "p95Ms": 1 }
  } } },
  "gates": { "passed": %t, "informational": false, "results": [] },
  "passed": %t,
  "cases": []
}`, id, evaluationID, startedAt, endedAt, passedCells, failedCells, passRate, passRate, passed, passed)
}
