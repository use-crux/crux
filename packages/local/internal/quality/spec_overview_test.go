package quality

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// The canonical overview is computed from the spec-02 records (experiments,
// baselines, cassettes) plus observability runs and derived insights — the
// legacy snapshot is not consulted.
func TestOverviewRecordAPIDerivesFromSpecRecords(t *testing.T) {
	svc := newSpecService(t)

	overview, err := svc.OverviewRecordAPI(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if overview.Tag != "QualityOverview" {
		t.Errorf("tag: %q", overview.Tag)
	}
	if overview.ExperimentCount != 2 || overview.BaselineCount != 1 || overview.CassetteCount != 1 {
		t.Errorf("counts: %+v", overview)
	}
	// Spec experiment A: 1/1 passed; B: 3/4 passed → 4/5 overall.
	if overview.PassRate == nil || *overview.PassRate != 0.8 {
		t.Errorf("passRate: %v", overview.PassRate)
	}
	if overview.LatestExperimentID != "01KTBBBBBBBBBBBBBBBBBBBBBB" {
		t.Errorf("latest experiment: %+v", overview)
	}
	if overview.LatestExperimentPassRate == nil || *overview.LatestExperimentPassRate != 0.75 {
		t.Errorf("latest pass rate: %v", overview.LatestExperimentPassRate)
	}
	if overview.LatestExperimentCompletedAt != "2026-06-13T01:00:05.000Z" {
		t.Errorf("latest completedAt: %q", overview.LatestExperimentCompletedAt)
	}
	// PassRateHistory buckets spec experiments; without an observability
	// service the run-derived series exist but are empty/zeroed.
	if len(overview.PassRateHistory) != 14 {
		t.Errorf("passRateHistory length: %d", len(overview.PassRateHistory))
	}
	// The insight derivation runs over spec records: experiment B has a
	// failed cell → one open experiment insight (severity counts non-empty).
	if overview.InsightCount == 0 {
		t.Errorf("insightCount: %+v", overview)
	}
	if overview.OpenInsightSeverityCounts["medium"] == 0 {
		t.Errorf("severity counts: %+v", overview.OpenInsightSeverityCounts)
	}
	if overview.StaleCassetteCount != 0 {
		t.Errorf("staleCassettes: %+v", overview)
	}
}

func TestOverviewRecordAPIWindowFiltersSpecRecords(t *testing.T) {
	now := time.Now().UTC()
	recent := now.Add(-2 * time.Hour).Format(time.RFC3339Nano)
	old := now.Add(-48 * time.Hour).Format(time.RFC3339Nano)
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTRECENTWINDOW0000000000.json", overviewExperimentFixture("01KTRECENTWINDOW0000000000", "evals.window.recent", recent, true))
	writeSpecFixture(t, dir, "experiments", "01KTOLDWINDOW000000000000.json", overviewExperimentFixture("01KTOLDWINDOW000000000000", "evals.window.old", old, false))
	writeSpecFixture(t, dir, "baselines", "evals.window.recent.json", overviewBaselineFixture("01KTBASEWINDOWRECENT", "evals.window.recent", recent))
	writeSpecFixture(t, dir, "baselines", "evals.window.old.json", overviewBaselineFixture("01KTBASEWINDOWOLD", "evals.window.old", old))
	writeSpecFixture(t, dir, "cassettes", "recent-window.json", overviewCassetteFixture(recent))
	writeSpecFixture(t, dir, "cassettes", "old-window.json", overviewCassetteFixture(old))

	svc := NewService(store.NewStore(), dir)
	recentOverview, err := svc.OverviewRecordAPI(context.Background(), "24h")
	if err != nil {
		t.Fatal(err)
	}
	if recentOverview.ExperimentCount != 1 || recentOverview.BaselineCount != 1 || recentOverview.CassetteCount != 1 {
		t.Fatalf("24h counts = %+v, want one recent experiment/baseline/cassette", recentOverview)
	}
	if recentOverview.PassRate == nil || *recentOverview.PassRate != 1 {
		t.Fatalf("24h pass rate = %v, want 1", recentOverview.PassRate)
	}
	if recentOverview.LatestExperimentID != "01KTRECENTWINDOW0000000000" {
		t.Fatalf("24h latest experiment = %q", recentOverview.LatestExperimentID)
	}

	allOverview, err := svc.OverviewRecordAPI(context.Background(), "all")
	if err != nil {
		t.Fatal(err)
	}
	if allOverview.ExperimentCount != 2 || allOverview.BaselineCount != 2 || allOverview.CassetteCount != 2 {
		t.Fatalf("all counts = %+v, want both records", allOverview)
	}
	if allOverview.PassRate == nil || *allOverview.PassRate != 0.5 {
		t.Fatalf("all pass rate = %v, want 0.5", allOverview.PassRate)
	}
}

// The experiment-failure insight rule reads spec-02 records: ids, failed
// cell case ids, and counts come from the new shapes (the legacy parse used
// to yield empty ids and 0/0 summaries here).
func TestDeriveInsightsFromSpecExperiments(t *testing.T) {
	records, _, err := qualityfs.Open(specDir(t)).ReadExperimentRecords()
	if err != nil {
		t.Fatal(err)
	}
	insights := deriveInsights(qualityInsightInputs{
		SpecExperiments: records,
		Now:             time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC),
	})
	var experimentInsight *qualityInsightRecord
	for index := range insights {
		if insights[index].InsightID == "experiment-01ktbbbbbbbbbbbbbbbbbbbbbb" {
			experimentInsight = &insights[index]
		}
	}
	if experimentInsight == nil {
		t.Fatalf("missing experiment insight: %+v", insights)
	}
	if len(experimentInsight.LinkedExperimentIDs) != 1 || experimentInsight.LinkedExperimentIDs[0] != "01KTBBBBBBBBBBBBBBBBBBBBBB" {
		t.Errorf("linked experiments: %+v", experimentInsight.LinkedExperimentIDs)
	}
	if len(experimentInsight.LinkedCaseIDs) != 1 || experimentInsight.LinkedCaseIDs[0] != "c1" {
		t.Errorf("linked cases: %+v", experimentInsight.LinkedCaseIDs)
	}
	// Experiment A passed fully — no insight for it.
	for _, insight := range insights {
		if insight.InsightID == "experiment-01ktaaaaaaaaaaaaaaaaaaaaaa" {
			t.Errorf("passing experiment must not produce an insight")
		}
	}
}

func overviewExperimentFixture(id string, evaluationID string, at string, passed bool) string {
	passedCells := 0
	failedCells := 1
	passRate := 0.0
	status := "failed"
	if passed {
		passedCells = 1
		failedCells = 0
		passRate = 1
		status = "passed"
	}
	return fmt.Sprintf(`{
  "schemaVersion": 1,
  "experimentId": %q,
  "evaluationId": %q,
  "qualityId": "local",
  "startedAt": %q,
  "endedAt": %q,
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": %d, "failed": %d, "errored": 0, "skipped": 0, "passRate": %.1f,
    "scores": {}, "latency": { "meanMs": 1, "p95Ms": 1 }
  } } },
  "gates": { "passed": %t, "informational": false, "results": [] },
  "passed": %t,
  "cells": [{ "caseId": "case-1", "variantName": "default", "trial": 0, "status": %q, "input": {}, "scores": [], "assertions": { "ran": 0, "notEvaluated": 0, "outcomes": [] }, "durationMs": 1, "traceIds": [], "capturedSignals": [] }]
}`, id, evaluationID, at, at, passedCells, failedCells, passRate, passed, passed, status)
}

func overviewBaselineFixture(id string, evaluationID string, promotedAt string) string {
	return fmt.Sprintf(`{
  "schemaVersion": 1,
  "baselineId": %q,
  "evaluationId": %q,
  "experimentId": "01KTPROMOTEDWINDOW",
  "promotedAt": %q,
  "configFingerprint": "cf",
  "reference": {}
}`, id, evaluationID, promotedAt)
}

func overviewCassetteFixture(recordedAt string) string {
	return fmt.Sprintf(`{
  "version": 1,
  "metadata": { "recordedAt": %q, "sdkVersion": "0.1.0", "models": [] },
  "entries": {}
}`, recordedAt)
}

func TestExperimentDetailAPI(t *testing.T) {
	svc := newSpecService(t)

	detail, found, err := svc.ExperimentDetailAPI(context.Background(), "01KTBBBBBBBBBBBBBBBBBBBBBB")
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}
	if detail.ExperimentID != "01KTBBBBBBBBBBBBBBBBBBBBBB" || detail.EvaluationID != "evals.bakeoff" {
		t.Errorf("ids: %+v", detail)
	}
	if len(detail.Variants) != 2 || detail.Variants[1].OverrideKeys[0] != "model" {
		t.Errorf("variants: %+v", detail.Variants)
	}
	current, ok := detail.Aggregates.PerVariant["current"]
	if !ok || current.PassRate != 1 || current.Scores["helpful"].Mean != 0.84 {
		t.Errorf("aggregates: %+v", detail.Aggregates)
	}
	if detail.Comparison == nil || detail.Comparison.Kind != "variant" || len(detail.Comparison.Deltas) != 1 {
		t.Errorf("comparison: %+v", detail.Comparison)
	}
	if !detail.Gates.Informational || len(detail.Gates.Results) != 2 {
		t.Errorf("gates: %+v", detail.Gates)
	}
	if len(detail.Cells) != 2 || detail.Cells[1].Status != "failed" {
		t.Errorf("cases: %+v", detail.Cells)
	}
	if _, found, _ := svc.ExperimentDetailAPI(context.Background(), "missing"); found {
		t.Error("missing experiment must not resolve")
	}
}
