package endpoints

import "github.com/use-crux/crux/packages/local/internal/readmodel"

type IncludeDeletedParams struct {
	IncludeDeleted bool
}

func (p *IncludeDeletedParams) Parse(req readmodel.Req) error {
	p.IncludeDeleted = req.Query.Get("include") == "deleted"
	return nil
}
