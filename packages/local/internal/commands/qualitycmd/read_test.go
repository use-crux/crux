package qualitycmd

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	qualityreport "github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

func TestQualityProgressCommandOutputsJSONReadModel(t *testing.T) {
	dir := t.TempDir()
	writeQualityCommandFixture(t, dir, "experiments", "01KTCLIPROGRESSNEW000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCLIPROGRESSNEW000000",
  "evaluationId": "evals.cli.progress",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:03.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 2, "passed": 1, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0.5,
    "scores": { "helpful": { "mean": 0.72, "sem": 0.04, "n": 2 } },
    "latency": { "meanMs": 1500, "p95Ms": 3000 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cells": []
}`)
	writeQualityCommandFixture(t, dir, "baselines", "evals.cli.progress.json", `{
  "schemaVersion": 1,
  "baselineId": "01KTCLIBASE",
  "evaluationId": "evals.cli.progress",
  "experimentId": "01KTCLIPROGRESSNEW000000",
  "promotedAt": "2026-06-14T12:01:00.000Z",
  "configFingerprint": "cf",
  "reference": { "case-1": { "helpful": 0.8 } }
}`)

	stdout := executeQualityCommand(t, "progress", "evals.cli.progress", "--limit", "1", "--json", "--dir", dir)

	var progress api.QualityEvaluationProgress
	if err := json.Unmarshal([]byte(stdout), &progress); err != nil {
		t.Fatalf("decode progress JSON: %v\n%s", err, stdout)
	}
	if progress.Tag != "QualityEvaluationProgress" || progress.EvaluationID != "evals.cli.progress" || progress.Limit != 1 {
		t.Fatalf("progress identity = %+v", progress)
	}
	if len(progress.Runs) != 1 || progress.Runs[0].ExperimentID != "01KTCLIPROGRESSNEW000000" {
		t.Fatalf("progress runs = %+v", progress.Runs)
	}
	if len(progress.ScoreSeries) != 1 || progress.ScoreSeries[0].Baseline == nil || progress.ScoreSeries[0].Baseline.BaselineID != "01KTCLIBASE" {
		t.Fatalf("progress score series = %+v", progress.ScoreSeries)
	}
}

func TestQualityCellEvidenceCommandOutputsJSONReadModel(t *testing.T) {
	dir := t.TempDir()
	writeQualityCommandFixture(t, dir, "experiments", "01KTCLICELL000000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCLICELL000000000000",
  "evaluationId": "evals.cli.cell",
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
    "caseId": "case-cli",
    "variantName": "default",
    "trial": 0,
    "status": "failed",
    "input": { "topic": "bananas" },
    "output": "bad",
    "scores": [],
    "assertions": {
      "ran": 1,
      "notEvaluated": 0,
      "outcomes": [{
        "id": "expect:evaluation:0",
        "level": "evaluation",
        "phase": "expect",
        "index": 0,
        "status": "failed",
        "matcher": "toBe",
        "soft": false,
        "message": "expected ok"
      }]
    },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)

	stdout := executeQualityCommand(t, "cell-evidence", "01KTCLICELL000000000000", "--case", "case-cli", "--variant", "default", "--trial", "0", "--json", "--dir", dir)

	var evidence api.QualityCellEvidence
	if err := json.Unmarshal([]byte(stdout), &evidence); err != nil {
		t.Fatalf("decode cell evidence JSON: %v\n%s", err, stdout)
	}
	if evidence.Tag != "QualityCellEvidence" || evidence.ExperimentID != "01KTCLICELL000000000000" {
		t.Fatalf("evidence identity = %+v", evidence)
	}
	if evidence.Cell.CaseID != "case-cli" || evidence.Cell.VariantName != "default" || evidence.Cell.Trial != 0 {
		t.Fatalf("evidence cell = %+v", evidence.Cell)
	}
	if evidence.Baseline.Kind != "unavailable" {
		t.Fatalf("baseline evidence = %+v", evidence.Baseline)
	}
}

func TestQualityLabelCommandWritesHumanLabelFeedback(t *testing.T) {
	dir := t.TempDir()

	executeQualityCommand(t, "label", "01KTLABELEXP00000000000", "--case", "refund-policy", "--verdict", "pass", "--score", "helpful", "--note", "matches policy", "--dir", dir)

	snapshot, err := qualityfs.Open(dir).Snapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(snapshot.Feedback) != 1 {
		t.Fatalf("feedback count = %d, want 1", len(snapshot.Feedback))
	}
	record := snapshot.Feedback[0]
	if record.ExperimentID == nil || *record.ExperimentID != "01KTLABELEXP00000000000" {
		t.Fatalf("experiment id = %+v", record.ExperimentID)
	}
	if record.CaseID == nil || *record.CaseID != "refund-policy" {
		t.Fatalf("case id = %+v", record.CaseID)
	}
	if record.Rating == nil || *record.Rating != 1 {
		t.Fatalf("rating = %+v", record.Rating)
	}
	if record.Comment == nil || *record.Comment != "matches policy" {
		t.Fatalf("comment = %+v", record.Comment)
	}
	if len(record.Tags) != 1 || record.Tags[0] != "human-label" {
		t.Fatalf("tags = %+v", record.Tags)
	}
	if record.Metadata["variant"] != "default" || record.Metadata["trial"] != float64(0) || record.Metadata["scoreName"] != "helpful" {
		t.Fatalf("metadata = %+v", record.Metadata)
	}
}

func TestQualityJudgeReportCommandOutputsJSON(t *testing.T) {
	dir := t.TempDir()
	writeQualityCommandFixture(t, dir, "experiments", "01KTCLIJUDGEREPORT00000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTCLIJUDGEREPORT00000",
  "evaluationId": "evals.cli.judge",
  "qualityId": "local",
  "startedAt": "2026-06-14T12:00:00.000Z",
  "endedAt": "2026-06-14T12:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": 1, "failed": 0, "errored": 0, "skipped": 0, "passRate": 1,
    "scores": { "helpful": { "mean": 0.9, "sem": 0, "n": 1 } },
    "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": true, "informational": false, "results": [
    { "gate": "scores.helpful.min", "threshold": 0.7, "actual": 0.9, "passed": true }
  ] },
  "passed": true,
  "cells": [{
    "caseId": "case-cli",
    "variantName": "default",
    "trial": 0,
    "status": "passed",
    "input": {},
    "output": "good",
    "scores": [{ "name": "helpful", "score": 0.9, "costClass": "model", "metadata": {
      "rationale": "helpful",
      "judge": { "model": "judge-model", "promptVersion": 1, "rubricFingerprint": "abc" }
    } }],
    "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)
	if _, err := qualityfs.Put(qualityfs.Open(dir), qualityfs.Feedback{
		ExperimentID: stringPtr("01KTCLIJUDGEREPORT00000"),
		CaseID:       stringPtr("case-cli"),
		Rating:       intPtr(1),
		Tags:         []string{"human-label"},
		Metadata:     map[string]any{"variant": "default", "trial": 0, "scoreName": "helpful"},
	}); err != nil {
		t.Fatalf("put label: %v", err)
	}

	stdout := executeQualityCommand(t, "judge-report", "evals.cli.judge", "--json", "--dir", dir)

	var report qualityreport.QualityJudgeReport
	if err := json.Unmarshal([]byte(stdout), &report); err != nil {
		t.Fatalf("decode judge report JSON: %v\n%s", err, stdout)
	}
	if report.EvaluationID != "evals.cli.judge" || len(report.Scorers) != 1 || report.Scorers[0].Agreement != 1 {
		t.Fatalf("judge report = %+v", report)
	}
}

func executeQualityCommand(t *testing.T, args ...string) string {
	t.Helper()
	cmd := New(&cli.Factory{})
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.SetOut(&stdout)
	cmd.SetErr(&stderr)
	cmd.SetArgs(args)
	cmd.SetContext(context.Background())
	if err := cmd.Execute(); err != nil {
		t.Fatalf("quality %v error: %v\nstderr:\n%s", args, err, stderr.String())
	}
	return stdout.String()
}

func writeQualityCommandFixture(t *testing.T, root string, subdir string, name string, content string) {
	t.Helper()
	dir := filepath.Join(root, subdir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
