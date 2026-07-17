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
		Inspect: &fakeQuality{
			activity: []api.InspectActivityEvent{{
				Tag: "InspectActivity", Kind: "run", Summary: "run completed", RefID: "trace-1",
			}},
			workbenchOverview: api.InspectOverviewRecord{Tag: "InspectOverview", RunCount: 1},
			runs:              []api.InspectRunRecord{{Tag: "InspectRun", TraceID: "trace-1", Status: "ok"}},
			insights: []api.InspectInsightRecord{{
				Tag: "Insight", InsightID: "insight-1", Title: "Missing coverage", Severity: "medium",
			}},
			silences: []api.InspectInsightSilenceRecord{{Tag: "QualityInsightSilence", ID: "silence-1"}},
			detail: api.InspectRunDetailRecord{
				Tag: "InspectRunDetail",
				Run: api.InspectRunRecord{TraceID: "trace-1", Status: "ok"},
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
	assertParity(t, mux, "/api/inspect/activity?limit=1", mustCall(t, func() ([]api.InspectActivityEvent, error) {
		return InspectActivity.Call(context.Background(), deps, &readmodel.Limit{N: 1})
	}))
	assertParity(t, mux, "/api/inspect/overview?window=24h", mustCall(t, func() (api.InspectOverviewRecord, error) {
		return InspectOverview.Call(context.Background(), deps, &InspectOverviewParams{Window: "24h"})
	}))
	assertParity(t, mux, "/api/inspect/insights", mustCall(t, func() ([]api.InspectInsightRecord, error) {
		return InspectInsights.Call(context.Background(), deps)
	}))
	assertParity(t, mux, "/api/inspect/insights/silences?include=deleted", mustCall(t, func() ([]api.InspectInsightSilenceRecord, error) {
		return InspectInsightSilences.Call(context.Background(), deps, &IncludeDeletedParams{IncludeDeleted: true})
	}))
	assertParity(t, mux, "/api/inspect/runs?status=ok&limit=1", mustCall(t, func() ([]api.InspectRunRecord, error) {
		return InspectRuns.Call(context.Background(), deps, &RunsParams{
			InspectRunsOptions: ParseRunsOptions(mapValues("status", "ok", "limit", "1")),
		})
	}))
	assertParity(t, mux, "/api/inspect/runs/trace-1", mustCall(t, func() (api.InspectRunDetailRecord, error) {
		return InspectRunDetail.Call(context.Background(), deps, &readmodel.PathID{ID: "trace-1"})
	}))
}

func assertParity(t *testing.T, mux *http.ServeMux, path string, direct any) {
	t.Helper()
	directJSON, err := json.Marshal(direct)
	if err != nil {
		t.Fatalf("%s marshal direct response: %v", path, err)
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("%s status = %d, want %d: %s", path, response.Code, http.StatusOK, response.Body.String())
	}
	if got, want := response.Body.String(), string(directJSON)+"\n"; got != want {
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
