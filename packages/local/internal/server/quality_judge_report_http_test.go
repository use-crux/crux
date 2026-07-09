package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHTTPServerQualityJudgeReportEndpoint(t *testing.T) {
	dir := t.TempDir()
	writeQualityProgressFixture(t, dir, "experiments", "01KTJUDGEHTTP0000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTJUDGEHTTP0000000000",
  "evaluationId": "evals.judge.http",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": {} },
  "gates": { "passed": true, "informational": false, "results": [
    { "gate": "scores.helpful.min", "threshold": 0.7, "actual": 0.85, "passed": true }
  ] },
  "passed": true,
  "cells": [{
    "caseId": "case-1", "variantName": "default", "trial": 0, "status": "passed", "input": {},
    "scores": [{ "name": "helpful", "score": 0.85, "costClass": "model", "metadata": {
      "rationale": "clearly helpful", "judge": { "model": "judge-model" }
    } }],
    "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] },
    "durationMs": 1000, "traceIds": [], "capturedSignals": []
  }]
}`)

	rating := 1
	experimentID := "01KTJUDGEHTTP0000000000"
	caseID := "case-1"
	if _, err := qualityfs.Put(qualityfs.Open(dir), qualityfs.Feedback{
		ExperimentID: &experimentID,
		CaseID:       &caseID,
		Rating:       &rating,
		Tags:         []string{"human-label"},
		Metadata:     map[string]any{"variant": "default", "trial": 0, "scoreName": "helpful"},
	}); err != nil {
		t.Fatalf("put label: %v", err)
	}

	s := store.NewStore()
	srv := NewHTTPServerWithQuality(s, quality.NewService(s, dir), ServerOptions{})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/judge-report/evals.judge.http")
	if err != nil {
		t.Fatalf("GET judge report error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("judge report status = %d, want 200", resp.StatusCode)
	}
	var report api.QualityJudgeReport
	if err := json.NewDecoder(resp.Body).Decode(&report); err != nil {
		t.Fatalf("decode judge report: %v", err)
	}
	if report.EvaluationID != "evals.judge.http" || len(report.Scorers) != 1 || report.Scorers[0].Name != "helpful" {
		t.Fatalf("judge report payload = %+v", report)
	}
	if report.Scorers[0].Confusion.TP != 1 || report.Scorers[0].Labeled != 1 {
		t.Fatalf("judge report confusion = %+v", report.Scorers[0])
	}

	missing, err := http.Get(ts.URL + "/api/quality/judge-report/evals.missing")
	if err != nil {
		t.Fatalf("GET missing judge report error: %v", err)
	}
	defer missing.Body.Close()
	if missing.StatusCode != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", missing.StatusCode)
	}
}
