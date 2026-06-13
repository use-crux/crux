package quality

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

const specExperimentA = `{
  "schemaVersion": 1,
  "experimentId": "01KTAAAAAAAAAAAAAAAAAAAAAA",
  "evaluationId": "prompt.conversation-title",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-12T22:34:58.720Z",
  "endedAt": "2026-06-12T22:34:58.736Z",
  "configFingerprint": "cf-a",
  "taskFingerprint": "tf-a",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": 1, "failed": 0, "errored": 0, "skipped": 0, "passRate": 1,
    "scores": { "pass": { "mean": 1, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 5, "p95Ms": 5 }
  } } },
  "gates": { "passed": true, "informational": false, "results": [
    { "gate": "default.assertions", "threshold": true, "actual": true, "passed": true }
  ] },
  "passed": true,
  "cases": [{
    "caseId": "case-1", "variantName": "default", "trial": 0, "status": "passed",
    "input": {}, "scores": [{ "name": "pass", "score": 1 }],
    "assertions": { "ran": 1, "notEvaluated": 0, "failures": [] },
    "durationMs": 5, "traceIds": [], "capturedSignals": []
  }]
}`

const specExperimentB = `{
  "schemaVersion": 1,
  "experimentId": "01KTBBBBBBBBBBBBBBBBBBBBBB",
  "evaluationId": "evals.bakeoff",
  "qualityId": "@packages/backend",
  "experimentLabel": "nightly",
  "startedAt": "2026-06-13T01:00:00.000Z",
  "endedAt": "2026-06-13T01:00:05.000Z",
  "configFingerprint": "cf-b",
  "taskFingerprint": "tf-b",
  "filteredRun": true,
  "replay": { "mode": "replay-strict", "cassette": "evals.bakeoff" },
  "baselineRef": { "baselineId": "01KTBASE", "experimentId": "01KTPROM" },
  "variants": [
    { "name": "current", "overrideKeys": [] },
    { "name": "candidate", "overrideKeys": ["model"] }
  ],
  "aggregates": { "perVariant": {
    "current": { "cells": 2, "passed": 2, "failed": 0, "errored": 0, "skipped": 0, "passRate": 1,
      "scores": { "helpful": { "mean": 0.84, "sem": 0.03, "n": 2 } },
      "latency": { "meanMs": 10, "p95Ms": 12 } },
    "candidate": { "cells": 2, "passed": 1, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0.5,
      "scores": { "helpful": { "mean": 0.7, "sem": 0.05, "n": 2 } },
      "latency": { "meanMs": 9, "p95Ms": 11 } }
  } },
  "comparison": {
    "kind": "variant", "baseline": "current",
    "deltas": [{ "variantName": "candidate", "scoreName": "helpful", "meanDelta": -0.14, "sem": 0.04, "n": 2 }],
    "unmatchedCases": { "baselineOnly": [], "candidateOnly": [] },
    "demoted": { "reason": "filtered run" }
  },
  "gates": { "passed": false, "informational": true, "results": [
    { "gate": "scores.helpful.min", "variantName": "candidate", "threshold": 0.8, "actual": 0.7, "passed": false },
    { "gate": "passRate", "variantName": "candidate", "threshold": 0.9, "actual": 0.5, "passed": false }
  ] },
  "passed": false,
  "cases": [
    { "caseId": "c1", "variantName": "current", "trial": 0, "status": "passed", "input": {},
      "scores": [{ "name": "helpful", "score": 0.84, "costClass": "model" }],
      "assertions": { "ran": 1, "notEvaluated": 0, "failures": [] },
      "durationMs": 10, "traceIds": [], "capturedSignals": [] },
    { "caseId": "c1", "variantName": "candidate", "trial": 0, "status": "failed", "input": {},
      "scores": [{ "name": "helpful", "score": 0.7, "costClass": "model" }],
      "assertions": { "ran": 1, "notEvaluated": 0, "failures": [] },
      "durationMs": 9, "traceIds": [], "capturedSignals": [] }
  ]
}`

const specBaselineRefunds = `{
  "schemaVersion": 1,
  "baselineId": "01KTBASE",
  "evaluationId": "evals.bakeoff",
  "experimentId": "01KTPROM",
  "promotedAt": "2026-06-12T20:00:00.000Z",
  "configFingerprint": "cf-b",
  "reference": { "c1": { "helpful": 0.84 } }
}`

const specCassetteFile = `{
  "version": 1,
  "metadata": { "recordedAt": "2026-06-12T21:41:07.070Z", "sdkVersion": "0.1.0", "models": ["openrouter/google/gemini-3.1-flash-lite-preview"] },
  "entries": { "k1": { "kind": "structured" }, "k2": { "kind": "loop" } }
}`

func newSpecService(t *testing.T) *Service {
	t.Helper()
	dir := t.TempDir()
	for sub, files := range map[string]map[string]string{
		"experiments": {
			"01KTAAAAAAAAAAAAAAAAAAAAAA.json": specExperimentA,
			"01KTBBBBBBBBBBBBBBBBBBBBBB.json": specExperimentB,
			"exp-legacy-1.json":               `{"_tag":"QualityExperiment","id":"exp-legacy-1","cases":[]}`,
		},
		"baselines": {"evals.bakeoff.json": specBaselineRefunds},
		"cassettes": {"mode-auto-detect.json": specCassetteFile},
	} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			t.Fatal(err)
		}
		for name, content := range files {
			if err := os.WriteFile(filepath.Join(dir, sub, name), []byte(content), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	return NewService(store.NewStore(), dir)
}

func TestExperimentSummariesAPI(t *testing.T) {
	svc := newSpecService(t)

	summaries, err := svc.ExperimentSummariesAPI(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 2 {
		t.Fatalf("got %d summaries, want 2 (legacy skipped): %+v", len(summaries), summaries)
	}

	newest := summaries[0]
	if newest.ExperimentID != "01KTBBBBBBBBBBBBBBBBBBBBBB" {
		t.Errorf("newest-first ordering: %+v", newest)
	}
	if newest.EvaluationID != "evals.bakeoff" || newest.QualityID != "@packages/backend" {
		t.Errorf("ids: %+v", newest)
	}
	if newest.ExperimentLabel != "nightly" || !newest.FilteredRun || newest.Passed {
		t.Errorf("label/filtered/passed: %+v", newest)
	}
	if newest.ReplayMode != "replay-strict" || newest.Cassette != "evals.bakeoff" {
		t.Errorf("replay: %+v", newest)
	}
	if newest.BaselineID != "01KTBASE" {
		t.Errorf("baselineRef: %+v", newest)
	}
	if len(newest.Variants) != 2 || newest.Variants[0] != "current" {
		t.Errorf("variants: %+v", newest.Variants)
	}
	if newest.Cells != 4 || newest.CellsPassed != 3 || newest.CellsFailed != 1 {
		t.Errorf("cell counts: %+v", newest)
	}
	if newest.GatesPassed || !newest.GatesInformational || newest.GateFailures != 2 {
		t.Errorf("gates: %+v", newest)
	}
	if !newest.HasComparison || !newest.ComparisonDemoted {
		t.Errorf("comparison flags: %+v", newest)
	}

	oldest := summaries[1]
	if oldest.ExperimentID != "01KTAAAAAAAAAAAAAAAAAAAAAA" || !oldest.Passed || oldest.Cells != 1 {
		t.Errorf("oldest summary: %+v", oldest)
	}
}

func TestExperimentRecordAPIServesVerbatimBytes(t *testing.T) {
	svc := newSpecService(t)

	raw, found, err := svc.ExperimentRecordAPI(context.Background(), "01KTAAAAAAAAAAAAAAAAAAAAAA")
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if string(raw) != specExperimentA {
		t.Error("detail must be the verbatim stored bytes")
	}
	if _, found, _ := svc.ExperimentRecordAPI(context.Background(), "exp-legacy-1"); found {
		t.Error("legacy record must not resolve")
	}
	if _, found, _ := svc.ExperimentRecordAPI(context.Background(), "missing"); found {
		t.Error("missing record must not resolve")
	}
}

func TestBaselineRecordsAPI(t *testing.T) {
	svc := newSpecService(t)

	records, err := svc.BaselineRecordsAPI(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 {
		t.Fatalf("got %d baselines, want 1", len(records))
	}
	if string(records[0]) != specBaselineRefunds {
		t.Error("baseline list entries must be verbatim record bytes")
	}

	raw, found, err := svc.BaselineRecordAPI(context.Background(), "evals.bakeoff")
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if string(raw) != specBaselineRefunds {
		t.Error("baseline detail must be verbatim")
	}
}

func TestCassetteFilesAPI(t *testing.T) {
	svc := newSpecService(t)

	cassettes, err := svc.CassetteFilesAPI(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(cassettes) != 1 {
		t.Fatalf("got %d cassettes, want 1", len(cassettes))
	}
	cassette := cassettes[0]
	if cassette.Name != "mode-auto-detect" || cassette.EntryCount != 2 || cassette.SdkVersion != "0.1.0" {
		t.Errorf("cassette: %+v", cassette)
	}
	if cassette.Stale {
		t.Error("recent cassette must not be stale (recordedAt 2026-06-12, staleness window 90d)")
	}
	if len(cassette.Models) != 1 {
		t.Errorf("models: %+v", cassette.Models)
	}
}

func TestOverviewRecordAPI(t *testing.T) {
	svc := newSpecService(t)

	overview, err := svc.OverviewRecordAPI(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if overview.Experiments != 2 || overview.Baselines != 1 || overview.Cassettes != 1 {
		t.Errorf("counts: %+v", overview)
	}
	if overview.LegacyExperimentsSkipped != 1 {
		t.Errorf("legacy skip surfacing: %+v", overview)
	}
	if overview.LastExperiment == nil ||
		overview.LastExperiment.ExperimentID != "01KTBBBBBBBBBBBBBBBBBBBBBB" ||
		overview.LastExperiment.EvaluationID != "evals.bakeoff" ||
		overview.LastExperiment.Passed {
		t.Errorf("lastExperiment: %+v", overview.LastExperiment)
	}
}

func TestScorerStatsAPI(t *testing.T) {
	svc := newSpecService(t)

	scorers, err := svc.ScorerStatsAPI(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]bool{}
	for _, scorer := range scorers {
		byName[scorer.Name] = true
		if scorer.Name == "helpful" {
			if scorer.CostClass != "model" || scorer.CellCount != 2 {
				t.Errorf("helpful: %+v", scorer)
			}
			if scorer.MeanScore == nil || *scorer.MeanScore != 0.77 {
				t.Errorf("helpful mean: %+v", scorer.MeanScore)
			}
			if len(scorer.EvaluationIDs) != 1 || scorer.EvaluationIDs[0] != "evals.bakeoff" {
				t.Errorf("helpful evaluations: %+v", scorer.EvaluationIDs)
			}
		}
	}
	if !byName["helpful"] || !byName["pass"] {
		t.Errorf("scorer names: %+v", scorers)
	}
}

// The API types must round-trip through JSON with camelCase field names —
// the devtools UI consumes them straight off the wire.
func TestExperimentSummaryJSONShape(t *testing.T) {
	svc := newSpecService(t)
	summaries, err := svc.ExperimentSummariesAPI(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(summaries[0])
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"experimentId", "evaluationId", "qualityId", "startedAt", "endedAt", "passed", "filteredRun", "replayMode", "variants", "cells", "gatesPassed", "gatesInformational"} {
		if _, ok := decoded[key]; !ok {
			t.Errorf("summary JSON missing %q: %s", key, data)
		}
	}
}
