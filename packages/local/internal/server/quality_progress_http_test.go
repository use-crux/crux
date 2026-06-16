package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHTTPServerQualityEvaluationProgressEndpoint(t *testing.T) {
	dir := t.TempDir()
	writeQualityProgressFixture(t, dir, "experiments", "01KTPROGRESSHTTP0000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTPROGRESSHTTP0000000000",
  "evaluationId": "evals.progress.http",
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
  "cases": []
}`)
	writeQualityProgressFixture(t, dir, "baselines", "evals.progress.http.json", `{
  "schemaVersion": 1,
  "baselineId": "01KTHTTPBASE",
  "evaluationId": "evals.progress.http",
  "experimentId": "01KTPROGRESSHTTP0000000000",
  "promotedAt": "2026-06-14T12:01:00.000Z",
  "configFingerprint": "cf",
  "reference": { "case-1": { "helpful": 0.75 } }
}`)

	s := store.NewStore()
	srv := NewHTTPServerWithQuality(s, quality.NewService(s, dir), ServerOptions{})
	ts := httptest.NewServer(srv)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/quality/evaluations/evals.progress.http/progress?limit=1")
	if err != nil {
		t.Fatalf("GET progress error: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("progress status = %d, want 200", resp.StatusCode)
	}
	var progress api.QualityEvaluationProgress
	if err := json.NewDecoder(resp.Body).Decode(&progress); err != nil {
		t.Fatalf("decode progress: %v", err)
	}
	if progress.EvaluationID != "evals.progress.http" || len(progress.Runs) != 1 {
		t.Fatalf("progress payload = %+v", progress)
	}
	if len(progress.ScoreSeries) != 1 || progress.ScoreSeries[0].Baseline == nil || progress.ScoreSeries[0].Baseline.BaselineID != "01KTHTTPBASE" {
		t.Fatalf("progress score series = %+v", progress.ScoreSeries)
	}

	missing, err := http.Get(ts.URL + "/api/quality/evaluations/evals.missing/progress")
	if err != nil {
		t.Fatalf("GET missing progress error: %v", err)
	}
	defer missing.Body.Close()
	if missing.StatusCode != http.StatusNotFound {
		t.Fatalf("missing status = %d, want 404", missing.StatusCode)
	}

	invalid, err := http.Get(ts.URL + "/api/quality/evaluations/evals.progress.http/progress?limit=nope")
	if err != nil {
		t.Fatalf("GET invalid progress error: %v", err)
	}
	defer invalid.Body.Close()
	if invalid.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid limit status = %d, want 400", invalid.StatusCode)
	}
}

func writeQualityProgressFixture(t *testing.T, root string, subdir string, name string, content string) {
	t.Helper()
	dir := filepath.Join(root, subdir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
