package endpoints

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

func TestRegisteredEndpointHTTPMatchesDirectCall(t *testing.T) {
	deps := Deps{
		Devtools: &fakeDevtools{index: api.IndexData{
			SchemaVersion: 1,
			Prompts:       []api.PromptMeta{{ID: "prompt-1", HasOutput: true}},
		}},
		Quality: &fakeQuality{
			activity: []api.QualityActivityEvent{
				{Tag: "QualityActivity", Kind: "run", Summary: "run completed", RefID: "trace-1"},
			},
			overview: api.QualityOverviewRecord{
				Tag:      "QualityOverview",
				RunCount: 1,
			},
			runs: []api.QualityRunRecord{
				{Tag: "QualityRun", TraceID: "trace-1", Status: "ok"},
			},
			suites: []api.QualitySuiteRecord{
				{Tag: "Suite", SuiteID: "suite-1"},
			},
			suite: api.QualitySuiteRecord{Tag: "Suite", SuiteID: "suite-1"},
			insights: []api.QualityInsightRecord{
				{Tag: "Insight", InsightID: "insight-1", Title: "Missing coverage", Severity: "medium"},
			},
			silences: []api.QualityInsightSilenceRecord{
				{Tag: "QualityInsightSilence", ID: "silence-1"},
			},
			detail: api.QualityRunDetailRecord{
				Tag: "QualityRunDetail",
				Run: api.QualityRunRecord{TraceID: "trace-1", Status: "ok"},
			},
			experiments: []api.QualityExperimentRecord{
				{Tag: "Experiment", ID: "experiment-1"},
			},
			experiment: api.QualityExperimentRecord{Tag: "Experiment", ID: "experiment-1"},
			comparisons: []api.QualityComparisonRecord{
				{Tag: "QualityComparison", ID: "comparison-1"},
			},
			comparison: api.QualityComparisonRecord{Tag: "QualityComparison", ID: "comparison-1"},
			baselines: []api.QualityBaselineRecord{
				{Tag: "QualityBaseline", ID: "baseline-1"},
			},
			baseline: api.QualityBaselineRecord{Tag: "QualityBaseline", ID: "baseline-1"},
			cassettes: []api.QualityCassetteRecord{
				{Path: "cassette.jsonl", Status: "ok"},
			},
			feedback: []api.QualityFeedbackRecord{
				{Tag: "QualityFeedback", ID: "feedback-1"},
			},
			annotations: []api.QualityFeedbackAnnotationRecord{
				{Tag: "QualityFeedbackAnnotation", ID: "annotation-1"},
			},
			proposals: []api.QualityFeedbackMemoryProposalRecord{
				{Tag: "QualityFeedbackMemoryProposal", ID: "proposal-1"},
			},
			scorers: []api.QualityScorerRecord{
				{Tag: "QualityScorer", Name: "faithfulness", Kind: "heuristic"},
			},
			experimentSummaries: []api.QualityExperimentSummary{
				{ExperimentID: "01KTAAAA", EvaluationID: "evals.bakeoff", Passed: true},
			},
			rawRecords: map[string]json.RawMessage{
				"01KTAAAA":      json.RawMessage(`{"schemaVersion":1,"experimentId":"01KTAAAA"}`),
				"evals.bakeoff": json.RawMessage(`{"schemaVersion":1,"baselineId":"01KTBASE"}`),
			},
			baselineRecords: []json.RawMessage{
				json.RawMessage(`{"schemaVersion":1,"baselineId":"01KTBASE"}`),
			},
			cassetteFiles: []api.QualityCassetteFileRecord{
				{Name: "mode-auto-detect", EntryCount: 2},
			},
			workbenchOverview: api.QualityOverviewRecord{Tag: "QualityOverview", ExperimentCount: 1},
			scorerStats: []api.QualityScorerStats{
				{Name: "helpful", EvaluationIDs: []string{"evals.bakeoff"}, CellCount: 2},
			},
		},
	}
	mux := http.NewServeMux()
	readmodel.Mount(mux, deps, Registry)

	assertParity(t, mux, "/api/project/index", mustCall(t, func() (api.IndexData, error) {
		return ProjectIndex.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/index", mustCall(t, func() (api.IndexData, error) {
		return ProjectIndex.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/activity?limit=1", mustCall(t, func() ([]api.QualityActivityEvent, error) {
		return QualityActivity.Call(context.Background(), deps, &readmodel.Limit{N: 1})
	}))
	assertParity(t, mux, "/api/quality/overview", mustCall(t, func() (api.QualityOverviewRecord, error) {
		return QualityWorkbenchOverview.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/experiments", mustCall(t, func() ([]api.QualityExperimentSummary, error) {
		return QualityExperimentSummaries.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/experiments/01KTAAAA", mustCall(t, func() (json.RawMessage, error) {
		return QualityExperimentRecord.Call(context.Background(), deps, &readmodel.PathID{ID: "01KTAAAA"})
	}))
	assertParity(t, mux, "/api/quality/baselines", mustCall(t, func() ([]json.RawMessage, error) {
		return QualityBaselineRecords.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/baselines/evals.bakeoff", mustCall(t, func() (json.RawMessage, error) {
		return QualityBaselineRecord.Call(context.Background(), deps, &readmodel.PathID{ID: "evals.bakeoff"})
	}))
	assertParity(t, mux, "/api/quality/cassettes", mustCall(t, func() ([]api.QualityCassetteFileRecord, error) {
		return QualityCassetteFiles.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/scorers", mustCall(t, func() ([]api.QualityScorerStats, error) {
		return QualityScorerStats.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/insights", mustCall(t, func() ([]api.QualityInsightRecord, error) {
		return QualityInsights.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/insights/silences?include=deleted", mustCall(t, func() ([]api.QualityInsightSilenceRecord, error) {
		return QualityInsightSilences.Call(context.Background(), deps, &IncludeDeletedParams{IncludeDeleted: true})
	}))
	assertParity(t, mux, "/api/quality/runs?status=ok&limit=1", mustCall(t, func() ([]api.QualityRunRecord, error) {
		return QualityRuns.Call(context.Background(), deps, &RunsParams{
			QualityRunsOptions: ParseRunsOptions(mapValues("status", "ok", "limit", "1")),
		})
	}))
	assertParity(t, mux, "/api/quality/runs/trace-1", mustCall(t, func() (api.QualityRunDetailRecord, error) {
		return QualityRunDetail.Call(context.Background(), deps, &readmodel.PathID{ID: "trace-1"})
	}))
	assertParity(t, mux, "/api/quality/feedback", mustCall(t, func() ([]api.QualityFeedbackRecord, error) {
		return QualityFeedback.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/feedback/annotations", mustCall(t, func() ([]api.QualityFeedbackAnnotationRecord, error) {
		return QualityFeedbackAnnotations.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/quality/feedback/memory-proposals", mustCall(t, func() ([]api.QualityFeedbackMemoryProposalRecord, error) {
		return QualityMemoryProposals.Call(context.Background(), deps)
	}))
}

func assertParity(t *testing.T, mux *http.ServeMux, path string, direct any) {
	t.Helper()
	directJSON, err := json.Marshal(direct)
	if err != nil {
		t.Fatalf("%s marshal direct response: %v", path, err)
	}
	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("%s status = %d, want %d: %s", path, resp.Code, http.StatusOK, resp.Body.String())
	}
	if got, want := resp.Body.String(), string(directJSON)+"\n"; got != want {
		t.Fatalf("%s HTTP JSON = %s, want %s", path, got, want)
	}
}

func mustCall[T any](t *testing.T, call func() (T, error)) T {
	t.Helper()
	value, err := call()
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func mapValues(kv ...string) map[string][]string {
	out := make(map[string][]string, len(kv)/2)
	for i := 0; i+1 < len(kv); i += 2 {
		out[kv[i]] = []string{kv[i+1]}
	}
	return out
}
