package prompttext

import (
	"context"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

type LatestRunLinkKind string

const (
	LatestRunLinkReady       LatestRunLinkKind = "ready"
	LatestRunLinkUnavailable LatestRunLinkKind = "unavailable"
)

// LatestRunLinkResult is the backend-neutral current owner proof for a
// latest-Run resolver link. Local's LSP server alone authors the URL.
type LatestRunLinkResult struct {
	Revision     transient.Revision
	Stamp        promptview.Stamp
	Kind         LatestRunLinkKind
	Reason       string
	DefinitionID string
}

// LatestRunLink projects the shared owner-at-cursor proof onto the strict
// ready/unavailable latest-Run contract.
func (c *Controller) LatestRunLink(
	ctx context.Context,
	request LanguageRequest,
	position protocol.Position,
) LatestRunLinkResult {
	return latestRunLinkFromOwner(c.ownerAt(ctx, request, position))
}

func latestRunLinkFromOwner(owner OwnerAtResult) LatestRunLinkResult {
	result := LatestRunLinkResult{
		Revision: owner.Revision, Stamp: owner.Stamp,
		Reason: owner.Reason, DefinitionID: owner.DefinitionID,
	}
	if owner.Kind == OwnerAtReady {
		result.Kind = LatestRunLinkReady
	} else {
		result.Kind = LatestRunLinkUnavailable
	}
	return result
}
