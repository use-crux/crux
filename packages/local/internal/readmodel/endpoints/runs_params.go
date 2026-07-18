package endpoints

import (
	"net/url"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

type RunsParams struct {
	api.InspectRunsOptions
}

func (p *RunsParams) Parse(req readmodel.Req) error {
	p.InspectRunsOptions = ParseRunsOptions(req.Query)
	return nil
}

func ParseRunsOptions(q url.Values) api.InspectRunsOptions {
	opts := api.InspectRunsOptions{
		Status:    splitCSV(q.Get("status")),
		Target:    splitCSV(q.Get("target")),
		Kind:      splitCSV(q.Get("kind")),
		Model:     splitCSV(q.Get("model")),
		Primitive: splitCSV(q.Get("primitive")),
		Session:   splitCSV(q.Get("session")),
		Search:    strings.TrimSpace(q.Get("search")),
		Sort:      strings.ToLower(strings.TrimSpace(q.Get("sort"))),
		Order:     strings.ToLower(strings.TrimSpace(q.Get("order"))),
	}
	if v, err := strconv.ParseInt(q.Get("since"), 10, 64); err == nil {
		opts.Since = v
	}
	if v, err := strconv.ParseInt(q.Get("until"), 10, 64); err == nil {
		opts.Until = v
	}
	if v, err := strconv.Atoi(q.Get("limit")); err == nil && v >= 0 {
		opts.Limit = v
	}
	if v, err := strconv.Atoi(q.Get("offset")); err == nil && v >= 0 {
		opts.Offset = v
	}
	return opts
}

func splitCSV(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
