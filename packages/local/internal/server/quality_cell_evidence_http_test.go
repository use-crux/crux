package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHTTPServerQualityCellEvidenceEndpoint(t *testing.T) {
	dir := t.TempDir()
	writeQualityProgressFixture(t, dir, "experiments", "01KTCELLHTTP000000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCELLHTTP000000000000",
  "evaluationId": "evals.cell.http",
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
    "caseId": "case-http",
    "variantName": "default",
    "trial": 0,
    "status": "failed",
    "input": {},
    "output": "bad",
    "scores": [],
    "assertions": {
      "ran": 1,
      "notEvaluated": 0,
      "failures": [{ "level": "evaluation", "index": 0, "matcher": "toBe", "soft": false, "message": "expected ok" }]
    },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)

	s := store.NewStore()
	srv := NewHTTPServerWithQuality(s, quality.NewService(s, dir), ServerOptions{})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/experiments/01KTCELLHTTP000000000000/cell-evidence?caseId=case-http&variantName=default&trial=0")
	if err != nil {
		t.Fatalf("GET cell evidence error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cell evidence status = %d, want 200", resp.StatusCode)
	}
	var evidence api.QualityCellEvidence
	if err := json.NewDecoder(resp.Body).Decode(&evidence); err != nil {
		t.Fatalf("decode cell evidence: %v", err)
	}
	if evidence.ExperimentID != "01KTCELLHTTP000000000000" || evidence.Cell.CaseID != "case-http" {
		t.Fatalf("cell evidence payload = %+v", evidence)
	}

	missing, err := http.Get(ts.URL + "/api/quality/experiments/01KTCELLHTTP000000000000/cell-evidence?caseId=missing&variantName=default&trial=0")
	if err != nil {
		t.Fatalf("GET missing cell evidence error: %v", err)
	}
	defer missing.Body.Close()
	if missing.StatusCode != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", missing.StatusCode)
	}

	invalid, err := http.Get(ts.URL + "/api/quality/experiments/01KTCELLHTTP000000000000/cell-evidence?caseId=case-http&variantName=default")
	if err != nil {
		t.Fatalf("GET invalid cell evidence error: %v", err)
	}
	defer invalid.Body.Close()
	if invalid.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid status = %d, want 400", invalid.StatusCode)
	}
}
