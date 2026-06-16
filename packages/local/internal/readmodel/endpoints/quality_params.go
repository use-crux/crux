package endpoints

import (
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

const defaultQualityOverviewWindow = "all"

type QualityOverviewParams struct {
	Window string
}

func (p *QualityOverviewParams) Parse(req readmodel.Req) error {
	window := req.Query.Get("window")
	if window == "" {
		window = defaultQualityOverviewWindow
	}
	switch window {
	case "24h", "7d", "30d", "all":
		p.Window = window
		return nil
	default:
		return readmodel.BadRequest("invalid window")
	}
}

type QualityExperimentsParams struct {
	api.QualityExperimentsOptions
}

func (p *QualityExperimentsParams) Parse(req readmodel.Req) error {
	q := req.Query
	status := strings.ToLower(strings.TrimSpace(q.Get("status")))
	if status != "" {
		switch status {
		case "passed", "failed", "informational", "running":
			p.Status = status
		default:
			return readmodel.BadRequest("invalid status")
		}
	}

	window := strings.ToLower(strings.TrimSpace(q.Get("window")))
	if window == "" {
		window = defaultQualityOverviewWindow
	}
	switch window {
	case "24h", "7d", "30d", "all":
		p.Window = window
	default:
		return readmodel.BadRequest("invalid window")
	}

	p.Evaluation = strings.TrimSpace(q.Get("evaluation"))
	limit, err := parseOptionalNonNegativeInt(q.Get("limit"), "limit")
	if err != nil {
		return err
	}
	p.Limit = limit
	offset, err := parseOptionalNonNegativeInt(q.Get("offset"), "offset")
	if err != nil {
		return err
	}
	p.Offset = offset
	if rawCursor := strings.TrimSpace(q.Get("cursor")); rawCursor != "" {
		cursor, err := parseOptionalNonNegativeInt(rawCursor, "cursor")
		if err != nil {
			return err
		}
		p.Offset = cursor
	}
	return nil
}

func parseOptionalNonNegativeInt(raw string, name string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 0, readmodel.BadRequest("invalid " + name)
	}
	return value, nil
}

type IncludeDeletedParams struct {
	IncludeDeleted bool
}

func (p *IncludeDeletedParams) Parse(req readmodel.Req) error {
	p.IncludeDeleted = req.Query.Get("include") == "deleted"
	return nil
}
