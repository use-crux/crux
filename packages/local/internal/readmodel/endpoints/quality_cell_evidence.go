package endpoints

import (
	"context"
	"strconv"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

var QualityCellEvidence = readmodel.GetP[Deps, *CellEvidenceParams, api.QualityCellEvidence](Registry, "GET /api/quality/experiments/{experimentId}/cell-evidence",
	func() *CellEvidenceParams { return &CellEvidenceParams{} },
	func(ctx context.Context, deps Deps, params *CellEvidenceParams) (api.QualityCellEvidence, error) {
		record, found, err := deps.Quality.CellEvidenceAPI(ctx, params.Query)
		if err != nil || found {
			return record, err
		}
		return record, readmodel.ErrNotFound
	})

type CellEvidenceParams struct {
	Query api.QualityCellEvidenceQuery
}

func (p *CellEvidenceParams) Parse(req readmodel.Req) error {
	if req.PathValue != nil {
		p.Query.ExperimentID = req.PathValue("experimentId")
	}
	if p.Query.ExperimentID == "" {
		return readmodel.BadRequest("experimentId is required")
	}
	p.Query.CaseID = req.Query.Get("caseId")
	if p.Query.CaseID == "" {
		return readmodel.BadRequest("caseId is required")
	}
	p.Query.VariantName = req.Query.Get("variantName")
	if p.Query.VariantName == "" {
		return readmodel.BadRequest("variantName is required")
	}
	rawTrial := req.Query.Get("trial")
	if rawTrial == "" {
		return readmodel.BadRequest("trial is required")
	}
	trial, err := strconv.Atoi(rawTrial)
	if err != nil || trial < 0 {
		return readmodel.BadRequest("invalid trial")
	}
	p.Query.Trial = trial
	return nil
}
