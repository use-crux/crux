package endpoints

import (
	"context"
	"encoding/json"
	"net/url"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

type fakeQuality struct {
	activity    []api.QualityActivityEvent
	overview    api.QualityOverviewRecord
	runs        []api.QualityRunRecord
	runOpts     api.QualityRunsOptions
	suites      []api.QualitySuiteRecord
	suite       api.QualitySuiteRecord
	insights    []api.QualityInsightRecord
	silences    []api.QualityInsightSilenceRecord
	detail      api.QualityRunDetailRecord
	experiments []api.QualityExperimentRecord
	experiment  api.QualityExperimentRecord
	comparisons []api.QualityComparisonRecord
	comparison  api.QualityComparisonRecord
	baselines   []api.QualityBaselineRecord
	baseline    api.QualityBaselineRecord
	cassettes   []api.QualityCassetteRecord
	feedback    []api.QualityFeedbackRecord
	annotations []api.QualityFeedbackAnnotationRecord
	proposals   []api.QualityFeedbackMemoryProposalRecord
	scorers     []api.QualityScorerRecord

	// Spec-02 read port fixtures (methods in quality_spec_test.go).
	experimentSummaries       []api.QualityExperimentSummary
	experimentsPage           api.QualityExperimentsPage
	experimentsOptions        api.QualityExperimentsOptions
	overviewWindow            string
	rawRecords                map[string]json.RawMessage
	baselineRecords           []json.RawMessage
	cassetteFiles             []api.QualityCassetteFileRecord
	workbenchOverview         api.QualityOverviewRecord
	scorerStats               []api.QualityScorerStats
	experimentDetails         map[string]api.QualityExperimentDetail
	promotedBaselines         []api.QualityPromotedBaseline
	evaluationProgress        api.QualityEvaluationProgress
	progressFound             bool
	progressEvaluation        string
	progressLimit             int
	evaluationExperiments     api.QualityEvaluationExperiments
	evaluationExperimentGroup api.QualityEvaluationExperimentGroups
	experimentsEvaluation     string
	experimentsLimit          int
	experimentGroupsLimit     int
	cellEvidence              api.QualityCellEvidence
	cellEvidenceFound         bool
	cellEvidenceQuery         api.QualityCellEvidenceQuery
}

func (f *fakeQuality) ActivityAPI(context.Context, int) ([]api.QualityActivityEvent, error) {
	return f.activity, nil
}

func (f *fakeQuality) OverviewAPI(context.Context) (api.QualityOverviewRecord, error) {
	return f.overview, nil
}

func (f *fakeQuality) RunsWithOptionsAPI(_ context.Context, opts api.QualityRunsOptions) ([]api.QualityRunRecord, error) {
	f.runOpts = opts
	return f.runs, nil
}

func (f *fakeQuality) SuitesAPI(context.Context) ([]api.QualitySuiteRecord, error) {
	return f.suites, nil
}

func (f *fakeQuality) SuiteAPI(context.Context, string) (api.QualitySuiteRecord, bool, error) {
	return f.suite, true, nil
}

func (f *fakeQuality) InsightsAPI(context.Context) ([]api.QualityInsightRecord, error) {
	return f.insights, nil
}

func (f *fakeQuality) InsightSilencesAPI(context.Context, bool) ([]api.QualityInsightSilenceRecord, error) {
	return f.silences, nil
}

func (f *fakeQuality) RunDetailAPI(context.Context, string) (api.QualityRunDetailRecord, bool, error) {
	return f.detail, true, nil
}

func (f *fakeQuality) ExperimentsAPI(context.Context) ([]api.QualityExperimentRecord, error) {
	return f.experiments, nil
}

func (f *fakeQuality) ExperimentAPI(context.Context, string) (api.QualityExperimentRecord, bool, error) {
	return f.experiment, true, nil
}

func (f *fakeQuality) ComparisonsAPI(context.Context) ([]api.QualityComparisonRecord, error) {
	return f.comparisons, nil
}

func (f *fakeQuality) ComparisonAPI(context.Context, string) (api.QualityComparisonRecord, bool, error) {
	return f.comparison, true, nil
}

func (f *fakeQuality) BaselinesAPI(context.Context) ([]api.QualityBaselineRecord, error) {
	return f.baselines, nil
}

func (f *fakeQuality) BaselineAPI(context.Context, string) (api.QualityBaselineRecord, bool, error) {
	return f.baseline, true, nil
}

func (f *fakeQuality) CassettesAPI(context.Context) ([]api.QualityCassetteRecord, error) {
	return f.cassettes, nil
}

func (f *fakeQuality) FeedbackAPI(context.Context) ([]api.QualityFeedbackRecord, error) {
	return f.feedback, nil
}

func (f *fakeQuality) FeedbackAnnotationsAPI(context.Context) ([]api.QualityFeedbackAnnotationRecord, error) {
	return f.annotations, nil
}

func (f *fakeQuality) MemoryProposalsAPI(context.Context) ([]api.QualityFeedbackMemoryProposalRecord, error) {
	return f.proposals, nil
}

func (f *fakeQuality) ScorersAPI(context.Context) ([]api.QualityScorerRecord, error) {
	return f.scorers, nil
}

func TestParseRunsOptionsIncludesRunRowFilters(t *testing.T) {
	opts := ParseRunsOptions(url.Values{
		"status": []string{"ok,error"},
		"kind":   []string{"generation,retrieval"},
		"target": []string{"support"},
		"model":  []string{"gpt-4o"},
		"has":    []string{"feedback"},
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
	if !reflect.DeepEqual(opts.Has, []string{"feedback"}) {
		t.Fatalf("has = %#v", opts.Has)
	}
}

func TestQualityRunsEndpointParsesFilterParams(t *testing.T) {
	quality := &fakeQuality{
		runs: []api.QualityRunRecord{{TraceID: "trace-1", Status: "ok"}},
	}

	got, err := QualityRuns.Call(context.Background(), Deps{Quality: quality}, &RunsParams{
		QualityRunsOptions: api.QualityRunsOptions{
			Status: []string{"ok"},
			Limit:  25,
			Offset: 5,
		},
	})
	if err != nil {
		t.Fatalf("QualityRuns.Call: %v", err)
	}
	if len(got) != 1 || got[0].TraceID != "trace-1" {
		t.Fatalf("runs = %+v, want trace-1", got)
	}
	if !reflect.DeepEqual(quality.runOpts.Status, []string{"ok"}) || quality.runOpts.Limit != 25 || quality.runOpts.Offset != 5 {
		t.Fatalf("run opts = %+v, want status/limit/offset", quality.runOpts)
	}
}

func TestQualityInsightsEndpointUsesQualityReadPort(t *testing.T) {
	want := []api.QualityInsightRecord{
		{Tag: "Insight", InsightID: "insight-1", Title: "Missing coverage", Severity: "medium"},
	}

	got, err := QualityInsights.Call(context.Background(), Deps{
		Quality: &fakeQuality{insights: want},
	})
	if err != nil {
		t.Fatalf("QualityInsights.Call: %v", err)
	}
	if len(got) != 1 || got[0].InsightID != "insight-1" {
		t.Fatalf("insights = %+v, want insight-1", got)
	}
}

func TestQualityRunDetailEndpointUsesTraceIDParam(t *testing.T) {
	want := api.QualityRunDetailRecord{
		Tag: "QualityRunDetail",
		Run: api.QualityRunRecord{TraceID: "trace-1"},
	}

	got, err := QualityRunDetail.Call(context.Background(), Deps{
		Quality: &fakeQuality{detail: want},
	}, &readmodel.PathID{ID: "trace-1"})
	if err != nil {
		t.Fatalf("QualityRunDetail.Call: %v", err)
	}
	if got.Run.TraceID != "trace-1" {
		t.Fatalf("trace ID = %q, want trace-1", got.Run.TraceID)
	}
}
