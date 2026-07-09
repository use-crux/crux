package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHTTPServerQualityEvaluationExperimentRelationsEndpoints(t *testing.T) {
	dir := t.TempDir()
	writeQualityProgressFixture(t, dir, "experiments", "01KTHTTPRELATIONOLD000000.json", qualityRelationHTTPExperimentRecord(
		"01KTHTTPRELATIONOLD000000",
		"evals.http.relations",
		"2026-06-14T10:00:00.000Z",
		"2026-06-14T10:00:01.000Z",
		true,
	))
	writeQualityProgressFixture(t, dir, "experiments", "01KTHTTPRELATIONNEW000000.json", qualityRelationHTTPExperimentRecord(
		"01KTHTTPRELATIONNEW000000",
		"evals.http.relations",
		"2026-06-14T11:00:00.000Z",
		"2026-06-14T11:00:01.000Z",
		false,
	))

	s := store.NewStore()
	srv := NewHTTPServerWithQuality(s, quality.NewService(s, dir), ServerOptions{})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/evaluations/evals.http.relations/experiments?limit=1")
	if err != nil {
		t.Fatalf("GET evaluation experiments error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("evaluation experiments status = %d, want 200", resp.StatusCode)
	}
	var relation api.QualityEvaluationExperiments
	if err := json.NewDecoder(resp.Body).Decode(&relation); err != nil {
		t.Fatalf("decode evaluation experiments: %v", err)
	}
	if relation.EvaluationID != "evals.http.relations" || relation.Total != 2 || relation.Limit != 1 || len(relation.Experiments) != 1 {
		t.Fatalf("relation payload = %+v", relation)
	}
	if got := relation.Experiments[0]; got.ExperimentID != "01KTHTTPRELATIONNEW000000" || got.Passed {
		t.Fatalf("relation newest experiment = %+v", got)
	}

	empty, err := http.Get(ts.URL + "/api/quality/evaluations/evals.no-runs-yet/experiments")
	if err != nil {
		t.Fatalf("GET empty evaluation experiments error: %v", err)
	}
	defer empty.Body.Close()
	if empty.StatusCode != http.StatusOK {
		t.Fatalf("empty relation status = %d, want 200", empty.StatusCode)
	}
	var emptyRelation api.QualityEvaluationExperiments
	if err := json.NewDecoder(empty.Body).Decode(&emptyRelation); err != nil {
		t.Fatalf("decode empty relation: %v", err)
	}
	if emptyRelation.Total != 0 || len(emptyRelation.Experiments) != 0 {
		t.Fatalf("empty relation payload = %+v", emptyRelation)
	}

	groupedResp, err := http.Get(ts.URL + "/api/quality/evaluations/experiment-groups?limit=1")
	if err != nil {
		t.Fatalf("GET grouped evaluation experiments error: %v", err)
	}
	defer groupedResp.Body.Close()
	if groupedResp.StatusCode != http.StatusOK {
		t.Fatalf("grouped status = %d, want 200", groupedResp.StatusCode)
	}
	var grouped api.QualityEvaluationExperimentGroups
	if err := json.NewDecoder(groupedResp.Body).Decode(&grouped); err != nil {
		t.Fatalf("decode grouped relation: %v", err)
	}
	if grouped.TotalEvaluations != 1 || grouped.TotalExperiments != 2 || len(grouped.Groups) != 1 || grouped.Groups[0].Total != 2 {
		t.Fatalf("grouped payload = %+v", grouped)
	}
}

func qualityRelationHTTPExperimentRecord(id, evaluationID, startedAt, endedAt string, passed bool) string {
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
  "cells": []
}`, id, evaluationID, startedAt, endedAt, passedCells, failedCells, passRate, passRate, passed, passed)
}
