package endpoints

import (
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

const defaultInspectOverviewWindow = "all"

type InspectOverviewParams struct {
	Window string
}

func (p *InspectOverviewParams) Parse(req readmodel.Req) error {
	window := req.Query.Get("window")
	if window == "" {
		window = defaultInspectOverviewWindow
	}
	switch window {
	case "24h", "7d", "30d", "all":
		p.Window = window
		return nil
	default:
		return readmodel.BadRequest("invalid window")
	}
}

type IncludeDeletedParams struct {
	IncludeDeleted bool
}

func (p *IncludeDeletedParams) Parse(req readmodel.Req) error {
	p.IncludeDeleted = req.Query.Get("include") == "deleted"
	return nil
}
