package endpoints

import (
	"context"
	"net/url"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

type fakeQuality struct {
	activity          []api.InspectActivityEvent
	runs              []api.InspectRunRecord
	runOpts           api.InspectRunsOptions
	insights          []api.InspectInsightRecord
	silences          []api.InspectInsightSilenceRecord
	detail            api.InspectRunDetailRecord
	workbenchOverview api.InspectOverviewRecord
}

func (f *fakeQuality) ActivityAPI(context.Context, int) ([]api.InspectActivityEvent, error) {
	return f.activity, nil
}

func (f *fakeQuality) OverviewRecordAPI(context.Context, ...string) (api.InspectOverviewRecord, error) {
	return f.workbenchOverview, nil
}

func (f *fakeQuality) RunsWithOptionsAPI(_ context.Context, opts api.InspectRunsOptions) ([]api.InspectRunRecord, error) {
	f.runOpts = opts
	return f.runs, nil
}

func (f *fakeQuality) InsightsAPI(context.Context) ([]api.InspectInsightRecord, error) {
	return f.insights, nil
}

func (f *fakeQuality) InsightSilencesAPI(context.Context, bool) ([]api.InspectInsightSilenceRecord, error) {
	return f.silences, nil
}

func (f *fakeQuality) RunDetailAPI(context.Context, string) (api.InspectRunDetailRecord, bool, error) {
	return f.detail, true, nil
}

func TestParseRunsOptionsIncludesRunRowFilters(t *testing.T) {
	opts := ParseRunsOptions(url.Values{
		"status": []string{"ok,error"},
		"kind":   []string{"generation,retrieval"},
		"target": []string{"support"},
		"model":  []string{"gpt-4o"},
	})

	if !reflect.DeepEqual(opts.Status, []string{"ok", "error"}) {
		t.Fatalf("status = %#v", opts.Status)
	}
	if !reflect.DeepEqual(opts.Kind, []string{"generation", "retrieval"}) {
		t.Fatalf("kind = %#v", opts.Kind)
	}
	if !reflect.DeepEqual(opts.Target, []string{"support"}) {
		t.Fatalf("target = %#v", opts.Target)
	}
	if !reflect.DeepEqual(opts.Model, []string{"gpt-4o"}) {
		t.Fatalf("model = %#v", opts.Model)
	}
}

func TestInspectRunsEndpointParsesFilterParams(t *testing.T) {
	quality := &fakeQuality{
		runs: []api.InspectRunRecord{{TraceID: "trace-1", Status: "ok"}},
	}

	got, err := InspectRuns.Call(context.Background(), Deps{Inspect: quality}, &RunsParams{
		InspectRunsOptions: api.InspectRunsOptions{
			Status: []string{"ok"},
			Limit:  25,
			Offset: 5,
		},
	})
	if err != nil {
		t.Fatalf("InspectRuns.Call: %v", err)
	}
	if len(got) != 1 || got[0].TraceID != "trace-1" {
		t.Fatalf("runs = %+v, want trace-1", got)
	}
	if !reflect.DeepEqual(quality.runOpts.Status, []string{"ok"}) || quality.runOpts.Limit != 25 || quality.runOpts.Offset != 5 {
		t.Fatalf("run opts = %+v, want status/limit/offset", quality.runOpts)
	}
}

func TestInspectInsightsEndpointUsesQualityReadPort(t *testing.T) {
	want := []api.InspectInsightRecord{
		{Tag: "Insight", InsightID: "insight-1", Title: "Missing coverage", Severity: "medium"},
	}

	got, err := InspectInsights.Call(context.Background(), Deps{
		Inspect: &fakeQuality{insights: want},
	})
	if err != nil {
		t.Fatalf("InspectInsights.Call: %v", err)
	}
	if len(got) != 1 || got[0].InsightID != "insight-1" {
		t.Fatalf("insights = %+v, want insight-1", got)
	}
}

func TestInspectRunDetailEndpointUsesTraceIDParam(t *testing.T) {
	want := api.InspectRunDetailRecord{
		Tag: "InspectRunDetail",
		Run: api.InspectRunRecord{TraceID: "trace-1"},
	}

	got, err := InspectRunDetail.Call(context.Background(), Deps{
		Inspect: &fakeQuality{detail: want},
	}, &readmodel.PathID{ID: "trace-1"})
	if err != nil {
		t.Fatalf("InspectRunDetail.Call: %v", err)
	}
	if got.Run.TraceID != "trace-1" {
		t.Fatalf("trace ID = %q, want trace-1", got.Run.TraceID)
	}
}
