package endpoints

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

// fakeQuality extensions for the spec-02 read port (struct fields live in
// quality_test.go's definition; methods may live in any file of the package).

func (f *fakeQuality) ExperimentSummariesAPI(context.Context) ([]api.QualityExperimentSummary, error) {
	return f.experimentSummaries, nil
}

func (f *fakeQuality) ExperimentRecordAPI(_ context.Context, id string) (json.RawMessage, bool, error) {
	raw, ok := f.rawRecords[id]
	return raw, ok, nil
}

func (f *fakeQuality) BaselineRecordsAPI(context.Context) ([]json.RawMessage, error) {
	return f.baselineRecords, nil
}

func (f *fakeQuality) BaselineRecordAPI(_ context.Context, evaluationID string) (json.RawMessage, bool, error) {
	raw, ok := f.rawRecords[evaluationID]
	return raw, ok, nil
}

func (f *fakeQuality) CassetteFilesAPI(context.Context) ([]api.QualityCassetteFileRecord, error) {
	return f.cassetteFiles, nil
}

func (f *fakeQuality) OverviewRecordAPI(context.Context) (api.QualityOverviewRecord, error) {
	return f.workbenchOverview, nil
}

func (f *fakeQuality) ExperimentDetailAPI(_ context.Context, id string) (api.QualityExperimentDetail, bool, error) {
	detail, ok := f.experimentDetails[id]
	return detail, ok, nil
}

func (f *fakeQuality) PromotedBaselinesAPI(context.Context) ([]api.QualityPromotedBaseline, error) {
	return f.promotedBaselines, nil
}

func (f *fakeQuality) EvaluationProgressAPI(_ context.Context, evaluationID string, limit int) (api.QualityEvaluationProgress, bool, error) {
	f.progressEvaluation = evaluationID
	f.progressLimit = limit
	return f.evaluationProgress, f.progressFound, nil
}

func (f *fakeQuality) ScorerStatsAPI(context.Context) ([]api.QualityScorerStats, error) {
	return f.scorerStats, nil
}

// The quality data surface is spec-02 only — the pre-rewrite read models
// (suites/comparisons/legacy experiments/baselines/cassettes/scorers) were
// deleted outright, no legacy namespace.
func TestQualityRegistryPatterns(t *testing.T) {
	patterns := map[string]bool{}
	for _, endpoint := range Registry.Endpoints() {
		patterns[endpoint.Pattern()] = true
	}

	for _, canonical := range []string{
		"GET /api/quality/experiments",
		"GET /api/quality/experiments/{experimentId}",
		"GET /api/quality/baselines",
		"GET /api/quality/baselines/{evaluationId}",
		"GET /api/quality/cassettes",
		"GET /api/quality/overview",
		"GET /api/quality/scorers",
		"GET /api/quality/evaluations",
		"GET /api/quality/evaluations/{evaluationId}/progress",
	} {
		if !patterns[canonical] {
			t.Errorf("canonical pattern missing: %s", canonical)
		}
	}

	for _, gone := range []string{
		"GET /api/quality/suites",
		"GET /api/quality/suites/{suiteId}",
		"GET /api/quality/comparisons",
		"GET /api/quality/comparisons/{comparisonId}",
		"GET /api/quality/legacy/overview",
		"GET /api/quality/legacy/suites",
		"GET /api/quality/legacy/experiments",
		"GET /api/quality/legacy/baselines",
		"GET /api/quality/legacy/cassettes",
		"GET /api/quality/legacy/scorers",
	} {
		if patterns[gone] {
			t.Errorf("retired pattern still registered: %s", gone)
		}
	}
}

func TestQualityExperimentSummariesEndpoint(t *testing.T) {
	want := []api.QualityExperimentSummary{{
		ExperimentID: "01KTAAAA", EvaluationID: "evals.bakeoff", Passed: true,
	}}
	got, err := QualityExperimentSummaries.Call(context.Background(), Deps{
		Quality: &fakeQuality{experimentSummaries: want},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ExperimentID != "01KTAAAA" {
		t.Fatalf("summaries = %+v", got)
	}
}

func TestQualityExperimentRecordEndpointServesRawAndNotFound(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":1,"experimentId":"01KTAAAA","future":"field"}`)
	fake := &fakeQuality{rawRecords: map[string]json.RawMessage{"01KTAAAA": raw}}

	got, err := QualityExperimentRecord.Call(context.Background(), Deps{Quality: fake}, &readmodel.PathID{ID: "01KTAAAA"})
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(raw) {
		t.Errorf("raw = %s", got)
	}

	_, err = QualityExperimentRecord.Call(context.Background(), Deps{Quality: fake}, &readmodel.PathID{ID: "missing"})
	if err == nil {
		t.Error("missing record must surface ErrNotFound")
	}
}

func TestQualityBaselineRecordEndpoints(t *testing.T) {
	raw := json.RawMessage(`{"schemaVersion":1,"baselineId":"01KTBASE","evaluationId":"evals.bakeoff"}`)
	fake := &fakeQuality{
		baselineRecords: []json.RawMessage{raw},
		rawRecords:      map[string]json.RawMessage{"evals.bakeoff": raw},
	}

	list, err := QualityBaselineRecords.Call(context.Background(), Deps{Quality: fake})
	if err != nil || len(list) != 1 {
		t.Fatalf("list=%v err=%v", list, err)
	}
	record, err := QualityBaselineRecord.Call(context.Background(), Deps{Quality: fake}, &readmodel.PathID{ID: "evals.bakeoff"})
	if err != nil || string(record) != string(raw) {
		t.Fatalf("record=%s err=%v", record, err)
	}
}

func TestQualityCassetteFilesEndpoint(t *testing.T) {
	want := []api.QualityCassetteFileRecord{{Name: "mode-auto-detect", EntryCount: 2, Stale: false}}
	got, err := QualityCassetteFiles.Call(context.Background(), Deps{
		Quality: &fakeQuality{cassetteFiles: want},
	})
	if err != nil || len(got) != 1 || got[0].Name != "mode-auto-detect" {
		t.Fatalf("cassettes=%v err=%v", got, err)
	}
}

func TestQualityWorkbenchOverviewEndpoint(t *testing.T) {
	got, err := QualityWorkbenchOverview.Call(context.Background(), Deps{
		Quality: &fakeQuality{workbenchOverview: api.QualityOverviewRecord{ExperimentCount: 3}},
	})
	if err != nil || got.ExperimentCount != 3 {
		t.Fatalf("overview=%v err=%v", got, err)
	}
}

func TestQualityScorerStatsEndpoint(t *testing.T) {
	got, err := QualityScorerStats.Call(context.Background(), Deps{
		Quality: &fakeQuality{scorerStats: []api.QualityScorerStats{{Name: "helpful"}}},
	})
	if err != nil || len(got) != 1 || got[0].Name != "helpful" {
		t.Fatalf("scorers=%v err=%v", got, err)
	}
}

func TestQualityEvaluationProgressEndpoint(t *testing.T) {
	want := api.QualityEvaluationProgress{
		Tag:           "QualityEvaluationProgress",
		SchemaVersion: 1,
		EvaluationID:  "evals.bakeoff",
		Limit:         5,
		Runs:          []api.QualityEvaluationProgressRun{{ExperimentID: "01KTAAAA", Verdict: "passed", PassRate: 1}},
	}
	fake := &fakeQuality{evaluationProgress: want, progressFound: true}

	got, err := QualityEvaluationProgress.Call(context.Background(), Deps{Quality: fake}, &evaluationProgressParams{
		EvaluationID: "evals.bakeoff",
		Limit:        5,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.EvaluationID != "evals.bakeoff" || len(got.Runs) != 1 {
		t.Fatalf("progress = %+v", got)
	}
	if fake.progressEvaluation != "evals.bakeoff" || fake.progressLimit != 5 {
		t.Fatalf("service params = evaluation %q limit %d", fake.progressEvaluation, fake.progressLimit)
	}

	_, err = QualityEvaluationProgress.Call(context.Background(), Deps{Quality: &fakeQuality{}}, &evaluationProgressParams{
		EvaluationID: "missing",
		Limit:        20,
	})
	if err == nil {
		t.Fatal("missing progress must surface ErrNotFound")
	}
}
