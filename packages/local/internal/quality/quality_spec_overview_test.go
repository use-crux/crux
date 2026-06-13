package quality

import (
	"context"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
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
	if len(detail.Cases) != 2 || detail.Cases[1].Status != "failed" {
		t.Errorf("cases: %+v", detail.Cases)
	}
	if _, found, _ := svc.ExperimentDetailAPI(context.Background(), "missing"); found {
		t.Error("missing experiment must not resolve")
	}
}
