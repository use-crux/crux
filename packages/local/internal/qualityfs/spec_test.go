package qualityfs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// A real engine-produced spec-02 ExperimentRecord (Karyla backend,
// prompt.conversation-title) — the verbatim contract the read model serves.
const specExperimentMinimal = `{
  "schemaVersion": 1,
  "experimentId": "01KTYZJS9GEX7TCQ52KF00BGPN",
  "evaluationId": "prompt.conversation-title",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-12T22:34:58.720Z",
  "endedAt": "2026-06-12T22:34:58.736Z",
  "configFingerprint": "14c1d6e70e380881345c58bf03f46cd91b0424a7ef7cd4c0b6a933ca7b3ae0b9",
  "taskFingerprint": "7f9b6c47c59ee2bb26a0fc29bf6e6099cbe5459c9ea962b925c63fbb096b6fb5",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": {
    "perVariant": {
      "default": {
        "cells": 1, "passed": 1, "failed": 0, "errored": 0, "skipped": 0,
        "passRate": 1,
        "scores": { "pass": { "mean": 1, "sem": 0, "n": 1 } },
        "latency": { "meanMs": 5, "p95Ms": 5 }
      }
    }
  },
  "gates": {
    "passed": true,
    "informational": false,
    "results": [{ "gate": "default.assertions", "threshold": true, "actual": true, "passed": true }]
  },
  "passed": true,
  "cells": [
    {
      "caseId": "generates-concise-topic-title",
      "caseName": "generates concise topic title",
      "variantName": "default",
      "trial": 0,
      "status": "passed",
      "input": { "message": "Can you help me?" },
      "output": { "text": "TypeScript" },
      "scores": [{ "name": "pass", "score": 1 }],
      "assertions": { "ran": 3, "notEvaluated": 0, "outcomes": [] },
      "durationMs": 5,
      "traceIds": ["run_mqbi8ai0_r2qh15b0"],
      "capturedSignals": []
    }
  ]
}`

// Kitchen-sink record exercising the Phase 2–5 additive fields: variants,
// replay cassette + trialsCollapsed + staleSince, baselineRef, comparison
// (incl. demoted), informational gates, assertion failures with sourceRef,
// cell error with missingCassetteKey, cell metadata, consistency, usage.
const specExperimentFull = `{
  "schemaVersion": 1,
  "experimentId": "01KTZZZZZZZZZZZZZZZZZZZZZZ",
  "evaluationId": "evals.bakeoff",
  "qualityId": "fixture",
  "experimentLabel": "nightly",
  "startedAt": "2026-06-13T01:00:00.000Z",
  "endedAt": "2026-06-13T01:00:05.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": true,
  "replay": { "mode": "replay-strict", "cassette": "evals.bakeoff", "trialsCollapsed": true, "staleSince": "2026-01-01T00:00:00.000Z" },
  "baselineRef": { "baselineId": "01KTBASE", "experimentId": "01KTPROMOTED", "variantName": "current" },
  "variants": [
    { "name": "current", "overrideKeys": [] },
    { "name": "candidate", "overrideKeys": ["model"], "overrides": { "model": "gpt-5" } }
  ],
  "aggregates": {
    "perVariant": {
      "current": {
        "cells": 2, "passed": 2, "failed": 0, "errored": 0, "skipped": 0, "passRate": 1,
        "scores": { "helpful": { "mean": 0.84, "sem": 0.03, "n": 2 } },
        "consistency": { "passAtK": 1, "passAllTrials": 0.5 },
        "latency": { "meanMs": 4100, "p95Ms": 5000 },
        "costUsd": 0.21
      },
      "candidate": {
        "cells": 2, "passed": 1, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0.5,
        "scores": { "helpful": { "mean": 0.87, "sem": 0.03, "n": 2 } },
        "latency": { "meanMs": 3800, "p95Ms": 4000 }
      }
    }
  },
  "comparison": {
    "kind": "promoted",
    "baseline": "01KTPROMOTED",
    "deltas": [{ "variantName": "candidate", "scoreName": "helpful", "meanDelta": 0.03, "sem": 0.02, "n": 2 }],
    "unmatchedCases": { "baselineOnly": ["old-case"], "candidateOnly": [] },
    "demoted": { "reason": "configFingerprint drift" }
  },
  "gates": {
    "passed": true,
    "informational": true,
    "results": [
      { "gate": "scores.helpful.minDeltaVsBaseline", "variantName": "candidate", "threshold": -0.02, "actual": 0.03, "passed": false, "informational": true }
    ]
  },
  "passed": false,
  "cells": [
    {
      "caseId": "refund-after-60-days",
      "variantName": "candidate",
      "trial": 1,
      "status": "failed",
      "input": { "q": "refund?" },
      "output": "Our policy…",
      "expected": { "answer": "30 days" },
      "scores": [{ "name": "helpful", "score": 0.41, "label": "weak", "costClass": "model", "metadata": { "rationale": "misses policy" } }],
      "assertions": {
        "ran": 3,
        "notEvaluated": 2,
        "outcomes": [{
          "id": "expect:evaluation:1", "level": "evaluation", "phase": "expect", "index": 1,
          "status": "failed", "matcher": "output.toMatch", "soft": false,
          "message": "expected /30 days/",
          "expected": { "label": "expected", "value": "/30 days/", "preview": "/30 days/", "redacted": false },
          "actual": { "label": "actual", "value": "Our policy…", "preview": "Our policy…", "redacted": false },
          "sourceRef": "support-refunds.eval.ts:31:9"
        }]
      },
      "error": { "message": "missing cassette entry", "phase": "replay", "missingCassetteKey": "loop:abc123" },
      "durationMs": 3800,
      "costUsd": 0.19,
      "usage": { "inputTokens": 1200, "outputTokens": 80 },
      "traceIds": ["run_a", "run_b"],
      "capturedSignals": ["toolCalls", "steps"],
      "metadata": { "truncated": true }
    }
  ]
}`

const legacyExperiment = `{
  "_tag": "QualityExperiment",
  "id": "exp-legacy-1",
  "qualityId": "demo",
  "suite": { "id": "agent-loops", "caseCount": 3 },
  "startedAt": "2026-06-01T00:00:00.000Z",
  "endedAt": "2026-06-01T00:00:05.000Z",
  "status": "completed",
  "summary": { "total": 3, "passed": 3, "failed": 0, "errored": 0 },
  "variants": [],
  "cells": []
}`

func writeSpecFixtures(t *testing.T) *FS {
	t.Helper()
	dir := t.TempDir()
	expDir := filepath.Join(dir, "experiments")
	if err := os.MkdirAll(expDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"01KTYZJS9GEX7TCQ52KF00BGPN.json": specExperimentMinimal,
		"01KTZZZZZZZZZZZZZZZZZZZZZZ.json": specExperimentFull,
		"exp-legacy-1.json":               legacyExperiment,
	} {
		if err := os.WriteFile(filepath.Join(expDir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return Open(dir)
}

func TestReadExperimentRecordsParsesSpecRecordsAndSkipsLegacy(t *testing.T) {
	fs := writeSpecFixtures(t)

	records, legacySkipped, err := fs.ReadExperimentRecords()
	if err != nil {
		t.Fatalf("ReadExperimentRecords: %v", err)
	}
	if legacySkipped != 1 {
		t.Errorf("legacySkipped = %d, want 1", legacySkipped)
	}
	if len(records) != 2 {
		t.Fatalf("got %d records, want 2", len(records))
	}
	// Newest-first by experimentId (ULIDs sort by creation time).
	if records[0].Record.ExperimentID != "01KTZZZZZZZZZZZZZZZZZZZZZZ" {
		t.Errorf("records[0] = %s, want the newest ULID first", records[0].Record.ExperimentID)
	}

	full := records[0].Record
	if full.EvaluationID != "evals.bakeoff" || full.QualityID != "fixture" {
		t.Errorf("ids: %+v", full)
	}
	if full.ExperimentLabel != "nightly" || !full.FilteredRun {
		t.Errorf("label/filteredRun: %+v", full)
	}
	if full.Replay.Mode != "replay-strict" || full.Replay.Cassette != "evals.bakeoff" ||
		!full.Replay.TrialsCollapsed || full.Replay.StaleSince != "2026-01-01T00:00:00.000Z" {
		t.Errorf("replay: %+v", full.Replay)
	}
	if full.BaselineRef == nil || full.BaselineRef.BaselineID != "01KTBASE" || full.BaselineRef.VariantName != "current" {
		t.Errorf("baselineRef: %+v", full.BaselineRef)
	}
	if len(full.Variants) != 2 || full.Variants[1].OverrideKeys[0] != "model" {
		t.Errorf("variants: %+v", full.Variants)
	}
	agg, ok := full.Aggregates.PerVariant["current"]
	if !ok || agg.Scores["helpful"].Mean != 0.84 || agg.Scores["helpful"].SEM != 0.03 {
		t.Errorf("aggregates: %+v", full.Aggregates.PerVariant)
	}
	if agg.Consistency == nil || agg.Consistency.PassAtK != 1 {
		t.Errorf("consistency: %+v", agg.Consistency)
	}
	if full.Comparison == nil || full.Comparison.Kind != "promoted" ||
		full.Comparison.Demoted == nil || full.Comparison.Demoted.Reason != "configFingerprint drift" {
		t.Errorf("comparison: %+v", full.Comparison)
	}
	if len(full.Comparison.Deltas) != 1 || full.Comparison.Deltas[0].MeanDelta != 0.03 {
		t.Errorf("deltas: %+v", full.Comparison.Deltas)
	}
	if !full.Gates.Informational || len(full.Gates.Results) != 1 || !full.Gates.Results[0].Informational {
		t.Errorf("gates: %+v", full.Gates)
	}
	if full.Passed {
		t.Error("passed should be false")
	}

	cell := full.Cells[0]
	if cell.Status != "failed" || cell.Assertions.NotEvaluated != 2 {
		t.Errorf("cell: %+v", cell)
	}
	if len(cell.Assertions.Outcomes) != 1 || cell.Assertions.Outcomes[0].SourceRef != "support-refunds.eval.ts:31:9" {
		t.Errorf("outcomes: %+v", cell.Assertions.Outcomes)
	}
	if cell.Error == nil || cell.Error.MissingCassetteKey != "loop:abc123" {
		t.Errorf("cell error: %+v", cell.Error)
	}
	if cell.Usage == nil || cell.Usage.InputTokens != 1200 {
		t.Errorf("usage: %+v", cell.Usage)
	}
	if len(cell.TraceIDs) != 2 || cell.CapturedSignals[0] != "toolCalls" {
		t.Errorf("traceIds/signals: %+v", cell)
	}
	if cell.Metadata["truncated"] != true {
		t.Errorf("metadata: %+v", cell.Metadata)
	}
	if cell.Scores[0].CostClass != "model" || cell.Scores[0].Metadata["rationale"] != "misses policy" {
		t.Errorf("scores: %+v", cell.Scores)
	}
}

func TestReadExperimentRecordRawIsVerbatim(t *testing.T) {
	fs := writeSpecFixtures(t)

	raw, found, err := fs.ReadExperimentRecordRaw("01KTYZJS9GEX7TCQ52KF00BGPN")
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	// Verbatim contract: the endpoint serves the exact stored bytes —
	// future additive engine fields must survive untouched.
	if string(raw) != specExperimentMinimal {
		t.Errorf("raw bytes differ from the stored record")
	}

	// A legacy record is not addressable through the spec read model.
	_, found, err = fs.ReadExperimentRecordRaw("exp-legacy-1")
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Error("legacy record must not resolve through ReadExperimentRecordRaw")
	}

	_, found, _ = fs.ReadExperimentRecordRaw("does-not-exist")
	if found {
		t.Error("missing record must report not-found")
	}
}

func TestReadExperimentRecordsToleratesMissingDir(t *testing.T) {
	fs := Open(t.TempDir())
	records, legacySkipped, err := fs.ReadExperimentRecords()
	if err != nil {
		t.Fatalf("missing experiments dir must not error: %v", err)
	}
	if len(records) != 0 || legacySkipped != 0 {
		t.Errorf("want empty result, got %d records / %d skipped", len(records), legacySkipped)
	}
}

// json.RawMessage round-trip sanity: the parsed struct is presentation-only;
// re-marshalling it must never be used to serve the record (lossy), so the
// reader exposes Raw alongside.
func TestExperimentRecordFileCarriesRawAlongsideParsed(t *testing.T) {
	fs := writeSpecFixtures(t)
	records, _, err := fs.ReadExperimentRecords()
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		var check struct {
			ExperimentID string `json:"experimentId"`
		}
		if err := json.Unmarshal(record.Raw, &check); err != nil {
			t.Fatalf("Raw is not valid JSON: %v", err)
		}
		if check.ExperimentID != record.Record.ExperimentID {
			t.Errorf("Raw and parsed record disagree: %s vs %s", check.ExperimentID, record.Record.ExperimentID)
		}
	}
}
