package server

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestDirectClient_rejects_legacy_trace_routes(t *testing.T) {
	s := store.NewStore()
	client := devtools.NewDirectClient(s)

	var traces []any
	err := client.GetJSON(context.Background(), "/api/traces", &traces)
	if err == nil || !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("GetJSON(/api/traces) error = %v, want unsupported path", err)
	}
}

func TestDirectClient_reads_quality_routes_from_service(t *testing.T) {
	s := store.NewStore()
	qualitySvc := quality.NewService(s, t.TempDir())
	client := devtools.NewDirectClient(s, qualitySvc)

	var overview api.QualityOverviewRecord
	if err := client.GetJSON(context.Background(), "/api/quality/overview", &overview); err != nil {
		t.Fatalf("GetJSON(/api/quality/overview) error: %v", err)
	}
	if overview.Tag != "QualityOverview" {
		t.Fatalf("overview tag = %q, want QualityOverview", overview.Tag)
	}

	qualitySvc.Events().PublishActivity(api.QualityActivityEvent{
		Tag:      "QualityActivityEvent",
		Kind:     "trace",
		Severity: "info",
		RefID:    "t1",
		Summary:  "trace started",
	})
	var activity []api.QualityActivityEvent
	if err := client.GetJSON(context.Background(), "/api/quality/activity?limit=1", &activity); err != nil {
		t.Fatalf("GetJSON(/api/quality/activity) error: %v", err)
	}
	if len(activity) != 1 || activity[0].RefID != "t1" {
		t.Fatalf("activity = %+v, want one event for t1", activity)
	}
}

func TestDirectClient_reads_quality_cell_evidence(t *testing.T) {
	dir := t.TempDir()
	writeQualityProgressFixture(t, dir, "experiments", "01KTDIRECTCELL0000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTDIRECTCELL0000000000",
  "evaluationId": "evals.direct.cell",
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
  "cells": [{
    "caseId": "case-direct",
    "variantName": "default",
    "trial": 0,
    "status": "failed",
    "input": {},
    "scores": [],
    "assertions": { "ran": 1, "notEvaluated": 0, "outcomes": [{ "id": "expect:evaluation:0", "level": "evaluation", "phase": "expect", "index": 0, "status": "failed", "matcher": "toBe", "soft": false, "message": "expected ok" }] },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)

	s := store.NewStore()
	qualitySvc := quality.NewService(s, dir)
	client := devtools.NewDirectClient(s, qualitySvc)

	var viaJSON api.QualityCellEvidence
	if err := client.GetJSON(context.Background(), "/api/quality/experiments/01KTDIRECTCELL0000000000/cell-evidence?caseId=case-direct&variantName=default&trial=0", &viaJSON); err != nil {
		t.Fatalf("GetJSON(cell-evidence) error: %v", err)
	}
	if viaJSON.ExperimentID != "01KTDIRECTCELL0000000000" || viaJSON.Cell.CaseID != "case-direct" {
		t.Fatalf("GetJSON cell evidence = %+v", viaJSON)
	}

	viaTyped, found, err := client.CellEvidence(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTDIRECTCELL0000000000",
		CaseID:       "case-direct",
		VariantName:  "default",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("typed cell evidence found=%v err=%v", found, err)
	}
	if viaTyped.Cell.CaseID != viaJSON.Cell.CaseID {
		t.Fatalf("typed cell evidence = %+v, GetJSON = %+v", viaTyped, viaJSON)
	}
}

func TestDirectClient_reads_quality_evaluation_progress(t *testing.T) {
	dir := t.TempDir()
	writeQualityProgressFixture(t, dir, "experiments", "01KTDIRECTPROGRESS000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTDIRECTPROGRESS000000",
  "evaluationId": "evals.direct.progress",
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
    "scores": { "helpful": { "mean": 0.8, "sem": 0.1, "n": 1 } },
    "latency": { "meanMs": 1, "p95Ms": 1 }
  } } },
  "gates": { "passed": true, "informational": false, "results": [] },
  "passed": true,
  "cells": []
}`)

	s := store.NewStore()
	qualitySvc := quality.NewService(s, dir)
	client := devtools.NewDirectClient(s, qualitySvc)

	var viaJSON api.QualityEvaluationProgress
	if err := client.GetJSON(context.Background(), "/api/quality/evaluations/evals.direct.progress/progress?limit=1", &viaJSON); err != nil {
		t.Fatalf("GetJSON(progress) error: %v", err)
	}
	if viaJSON.Tag != "QualityEvaluationProgress" || len(viaJSON.Runs) != 1 || viaJSON.Runs[0].ExperimentID != "01KTDIRECTPROGRESS000000" {
		t.Fatalf("GetJSON progress = %+v", viaJSON)
	}

	progress, found, err := client.EvaluationProgress(context.Background(), "evals.direct.progress", 1)
	if err != nil || !found {
		t.Fatalf("typed progress found=%v err=%v", found, err)
	}
	if progress.Tag != "QualityEvaluationProgress" || len(progress.Runs) != 1 || progress.Runs[0].ExperimentID != "01KTDIRECTPROGRESS000000" {
		t.Fatalf("typed progress = %+v", progress)
	}
}

func TestDirectClient_reads_quality_evaluation_experiment_relations(t *testing.T) {
	dir := t.TempDir()
	writeQualityProgressFixture(t, dir, "experiments", "01KTDIRECTRELATIONOLD0000.json", qualityRelationHTTPExperimentRecord(
		"01KTDIRECTRELATIONOLD0000",
		"evals.direct.relations",
		"2026-06-14T10:00:00.000Z",
		"2026-06-14T10:00:01.000Z",
		true,
	))
	writeQualityProgressFixture(t, dir, "experiments", "01KTDIRECTRELATIONNEW0000.json", qualityRelationHTTPExperimentRecord(
		"01KTDIRECTRELATIONNEW0000",
		"evals.direct.relations",
		"2026-06-14T11:00:00.000Z",
		"2026-06-14T11:00:01.000Z",
		false,
	))

	s := store.NewStore()
	qualitySvc := quality.NewService(s, dir)
	client := devtools.NewDirectClient(s, qualitySvc)

	var viaJSON api.QualityEvaluationExperiments
	if err := client.GetJSON(context.Background(), "/api/quality/evaluations/evals.direct.relations/experiments?limit=1", &viaJSON); err != nil {
		t.Fatalf("GetJSON(evaluation experiments) error: %v", err)
	}
	if viaJSON.Total != 2 || len(viaJSON.Experiments) != 1 || viaJSON.Experiments[0].ExperimentID != "01KTDIRECTRELATIONNEW0000" {
		t.Fatalf("GetJSON evaluation experiments = %+v", viaJSON)
	}

	viaTyped, err := client.EvaluationExperiments(context.Background(), "evals.direct.relations", 1)
	if err != nil {
		t.Fatalf("typed evaluation experiments error: %v", err)
	}
	if viaTyped.Total != viaJSON.Total || viaTyped.Experiments[0].ExperimentID != viaJSON.Experiments[0].ExperimentID {
		t.Fatalf("typed evaluation experiments = %+v, GetJSON = %+v", viaTyped, viaJSON)
	}

	var groupedJSON api.QualityEvaluationExperimentGroups
	if err := client.GetJSON(context.Background(), "/api/quality/evaluations/experiment-groups?limit=1", &groupedJSON); err != nil {
		t.Fatalf("GetJSON(evaluation experiment groups) error: %v", err)
	}
	groupedTyped, err := client.EvaluationExperimentGroups(context.Background(), 1)
	if err != nil {
		t.Fatalf("typed evaluation experiment groups error: %v", err)
	}
	if groupedTyped.TotalExperiments != groupedJSON.TotalExperiments || len(groupedTyped.Groups) != 1 || groupedTyped.Groups[0].Total != 2 {
		t.Fatalf("typed groups = %+v, GetJSON = %+v", groupedTyped, groupedJSON)
	}
}
