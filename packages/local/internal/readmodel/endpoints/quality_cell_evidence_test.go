package endpoints

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (f *fakeQuality) CellEvidenceAPI(_ context.Context, query api.QualityCellEvidenceQuery) (api.QualityCellEvidence, bool, error) {
	f.cellEvidenceQuery = query
	return f.cellEvidence, f.cellEvidenceFound, nil
}

func TestQualityCellEvidenceEndpoint(t *testing.T) {
	want := api.QualityCellEvidence{
		Tag:           "QualityCellEvidence",
		SchemaVersion: 1,
		ExperimentID:  "01KTCELL",
		EvaluationID:  "evals.cell",
		Cell: api.QualityCellIdentity{
			CaseID:      "case-1",
			VariantName: "candidate",
			Trial:       2,
			Status:      "failed",
		},
		Baseline: api.QualityBaselineEvidence{Kind: "unavailable", Reason: "no-baseline"},
	}
	fake := &fakeQuality{cellEvidence: want, cellEvidenceFound: true}

	got, err := QualityCellEvidence.Call(context.Background(), Deps{Quality: fake}, &CellEvidenceParams{
		Query: api.QualityCellEvidenceQuery{
			ExperimentID: "01KTCELL",
			CaseID:       "case-1",
			VariantName:  "candidate",
			Trial:        2,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.ExperimentID != "01KTCELL" || got.Cell.Trial != 2 {
		t.Fatalf("cell evidence = %+v", got)
	}
	if fake.cellEvidenceQuery.ExperimentID != "01KTCELL" ||
		fake.cellEvidenceQuery.CaseID != "case-1" ||
		fake.cellEvidenceQuery.VariantName != "candidate" ||
		fake.cellEvidenceQuery.Trial != 2 {
		t.Fatalf("service query = %+v", fake.cellEvidenceQuery)
	}

	_, err = QualityCellEvidence.Call(context.Background(), Deps{Quality: &fakeQuality{}}, &CellEvidenceParams{
		Query: api.QualityCellEvidenceQuery{
			ExperimentID: "missing",
			CaseID:       "case-1",
			VariantName:  "candidate",
			Trial:        0,
		},
	})
	if err == nil {
		t.Fatal("missing cell evidence must surface ErrNotFound")
	}
}
