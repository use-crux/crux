package endpoints

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

// QualityJudgeReport serves the judge-vs-human agreement report for one
// evaluation (blueprint §12.2). It is a thin GET wrapper over the same Go
// read model the CLI and MCP use; an evaluation with no experiment records is
// a 404.
var QualityJudgeReport = readmodel.GetP[Deps, *readmodel.PathID, api.QualityJudgeReport](Registry, "GET /api/quality/judge-report/{evaluationId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "evaluationId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (api.QualityJudgeReport, error) {
		report, found, err := deps.Quality.JudgeReportAPI(ctx, params.ID)
		if err != nil || found {
			return report, err
		}
		return report, readmodel.ErrNotFound
	})
