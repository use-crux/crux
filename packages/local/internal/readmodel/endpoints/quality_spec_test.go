package endpoints

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

// fakeQuality extensions for the spec-02 read port (struct fields live in
// quality_test.go's definition; methods may live in any file of the package).

func (f *fakeQuality) ExperimentSummariesAPI(context.Context) ([]api.QualityExperimentSummary, error) {
	return f.experimentSummaries, nil
}

func (f *fakeQuality) ExperimentsPageAPI(_ context.Context, opts api.QualityExperimentsOptions) (api.QualityExperimentsPage, error) {
	f.experimentsOptions = opts
	if f.experimentsPage.Tag != "" {
		return f.experimentsPage, nil
	}
	return api.QualityExperimentsPage{
		Tag:         "QualityExperimentsPage",
		Experiments: f.experimentSummaries,
		Total:       len(f.experimentSummaries),
	}, nil
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

func (f *fakeQuality) OverviewRecordAPI(_ context.Context, windows ...string) (api.QualityOverviewRecord, error) {
	if len(windows) > 0 {
		f.overviewWindow = windows[0]
	}
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

func (f *fakeQuality) EvaluationExperimentsAPI(_ context.Context, evaluationID string, limit int) (api.QualityEvaluationExperiments, error) {
	f.experimentsEvaluation = evaluationID
	f.experimentsLimit = limit
	return f.evaluationExperiments, nil
}

func (f *fakeQuality) EvaluationExperimentGroupsAPI(_ context.Context, limit int) (api.QualityEvaluationExperimentGroups, error) {
	f.experimentGroupsLimit = limit
	return f.evaluationExperimentGroup, nil
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
		"GET /api/quality/experiments/{experimentId}/cell-evidence",
		"GET /api/quality/baselines",
		"GET /api/quality/baselines/{evaluationId}",
		"GET /api/quality/cassettes",
		"GET /api/quality/overview",
		"GET /api/quality/scorers",
		"GET /api/quality/evaluations",
		"GET /api/quality/evaluations/experiment-groups",
		"GET /api/quality/evaluations/{evaluationId}/experiments",
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

func TestQualityEvaluationExperimentRelationEndpoints(t *testing.T) {
	fake := &fakeQuality{
		evaluationExperiments: api.QualityEvaluationExperiments{
			Tag:           "QualityEvaluationExperiments",
			SchemaVersion: 1,
			EvaluationID:  "evals.bakeoff",
			Limit:         2,
			Total:         3,
			Experiments:   []api.QualityExperimentSummary{{ExperimentID: "01KTAAAA", EvaluationID: "evals.bakeoff"}},
		},
		evaluationExperimentGroup: api.QualityEvaluationExperimentGroups{
			Tag:              "QualityEvaluationExperimentGroups",
			SchemaVersion:    1,
			Limit:            1,
			TotalEvaluations: 1,
			TotalExperiments: 3,
			Groups: []api.QualityEvaluationExperimentGroup{{
				EvaluationID: "evals.bakeoff",
				Total:        3,
				Experiments:  []api.QualityExperimentSummary{{ExperimentID: "01KTAAAA", EvaluationID: "evals.bakeoff"}},
			}},
		},
	}

	got, err := QualityEvaluationExperiments.Call(context.Background(), Deps{Quality: fake}, &evaluationProgressParams{
		EvaluationID: "evals.bakeoff",
		Limit:        2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.EvaluationID != "evals.bakeoff" || got.Total != 3 || fake.experimentsEvaluation != "evals.bakeoff" || fake.experimentsLimit != 2 {
		t.Fatalf("evaluation experiments = %+v, service params evaluation=%q limit=%d", got, fake.experimentsEvaluation, fake.experimentsLimit)
	}

	grouped, err := QualityEvaluationExperimentGroups.Call(context.Background(), Deps{Quality: fake}, &readmodel.Limit{N: 1})
	if err != nil {
		t.Fatal(err)
	}
	if grouped.TotalEvaluations != 1 || fake.experimentGroupsLimit != 1 {
		t.Fatalf("grouped experiments = %+v, service limit=%d", grouped, fake.experimentGroupsLimit)
	}
}

func TestQualityExperimentSummariesEndpoint(t *testing.T) {
	want := api.QualityExperimentsPage{
		Tag:         "QualityExperimentsPage",
		Experiments: []api.QualityExperimentSummary{{ExperimentID: "01KTAAAA", EvaluationID: "evals.bakeoff", Passed: true}},
		Total:       1,
	}
	fake := &fakeQuality{experimentsPage: want}
	got, err := QualityExperimentSummaries.Call(context.Background(), Deps{Quality: fake}, &QualityExperimentsParams{
		QualityExperimentsOptions: api.QualityExperimentsOptions{Status: "passed", Evaluation: "evals.bakeoff", Window: "7d", Limit: 25, Offset: 50},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Experiments) != 1 || got.Experiments[0].ExperimentID != "01KTAAAA" || got.Total != 1 {
		t.Fatalf("page = %+v", got)
	}
	if fake.experimentsOptions.Status != "passed" || fake.experimentsOptions.Evaluation != "evals.bakeoff" || fake.experimentsOptions.Window != "7d" || fake.experimentsOptions.Limit != 25 || fake.experimentsOptions.Offset != 50 {
		t.Fatalf("options = %+v", fake.experimentsOptions)
	}
}

func TestQualityExperimentsParamsParse(t *testing.T) {
	params := &QualityExperimentsParams{}
	err := params.Parse(readmodel.Req{Query: url.Values{
		"status":     []string{"failed"},
		"evaluation": []string{"evals.bakeoff"},
		"window":     []string{"30d"},
		"limit":      []string{"2"},
		"offset":     []string{"10"},
		"cursor":     []string{"20"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if params.Status != "failed" || params.Evaluation != "evals.bakeoff" || params.Window != "30d" || params.Limit != 2 || params.Offset != 20 {
		t.Fatalf("params = %+v", params)
	}
	if err := (&QualityExperimentsParams{}).Parse(readmodel.Req{Query: url.Values{"status": []string{"all"}}}); err == nil {
		t.Fatal("invalid status should fail")
	}
	if err := (&QualityExperimentsParams{}).Parse(readmodel.Req{Query: url.Values{"cursor": []string{"nope"}}}); err == nil {
		t.Fatal("invalid cursor should fail")
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
	fake := &fakeQuality{workbenchOverview: api.QualityOverviewRecord{ExperimentCount: 3}}
	got, err := QualityWorkbenchOverview.Call(context.Background(), Deps{
		Quality: fake,
	}, &QualityOverviewParams{Window: "24h"})
	if err != nil || got.ExperimentCount != 3 {
		t.Fatalf("overview=%v err=%v", got, err)
	}
	if fake.overviewWindow != "24h" {
		t.Fatalf("overview window = %q, want 24h", fake.overviewWindow)
	}
}

func TestQualityOverviewParams(t *testing.T) {
	var params QualityOverviewParams
	if err := params.Parse(readmodel.Req{}); err != nil {
		t.Fatal(err)
	}
	if params.Window != "all" {
		t.Fatalf("default window = %q", params.Window)
	}
	if err := params.Parse(readmodel.Req{Query: mapValues("window", "7d")}); err != nil {
		t.Fatal(err)
	}
	if params.Window != "7d" {
		t.Fatalf("window = %q, want 7d", params.Window)
	}
	if err := params.Parse(readmodel.Req{Query: mapValues("window", "yesterday")}); err == nil {
		t.Fatal("invalid window must fail")
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
