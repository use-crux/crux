package endpoints

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

func (f *fakeQuality) JudgeReportAPI(_ context.Context, evaluationID string) (api.QualityJudgeReport, bool, error) {
	f.judgeReportEvaluation = evaluationID
	return f.judgeReport, f.judgeReportFound, nil
}

func TestQualityJudgeReportEndpoint(t *testing.T) {
	want := api.QualityJudgeReport{
		SchemaVersion: 1,
		EvaluationID:  "evals.bakeoff",
		Scorers: []api.QualityJudgeReportScorer{{
			Name:      "helpful",
			Threshold: 0.7,
			Labeled:   3,
			Confusion: api.QualityJudgeReportConfusion{TP: 2, FP: 1},
			Agreement: 0.66,
		}},
	}
	fake := &fakeQuality{judgeReport: want, judgeReportFound: true}

	got, err := QualityJudgeReport.Call(context.Background(), Deps{Quality: fake}, &readmodel.PathID{ID: "evals.bakeoff"})
	if err != nil {
		t.Fatal(err)
	}
	if got.EvaluationID != "evals.bakeoff" || len(got.Scorers) != 1 || got.Scorers[0].Name != "helpful" {
		t.Fatalf("judge report = %+v", got)
	}
	if fake.judgeReportEvaluation != "evals.bakeoff" {
		t.Fatalf("service evaluationId = %q", fake.judgeReportEvaluation)
	}

	_, err = QualityJudgeReport.Call(context.Background(), Deps{Quality: &fakeQuality{}}, &readmodel.PathID{ID: "missing"})
	if err == nil {
		t.Fatal("missing evaluation must surface ErrNotFound")
	}
}
