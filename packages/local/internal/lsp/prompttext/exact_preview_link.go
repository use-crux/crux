package prompttext

import (
	"context"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

type ExactPreviewLinkKind string

const (
	ExactPreviewLinkReady       ExactPreviewLinkKind = "ready"
	ExactPreviewLinkStaticOnly  ExactPreviewLinkKind = "static-only"
	ExactPreviewLinkUnavailable ExactPreviewLinkKind = "unavailable"
)

// ExactPreviewLinkResult is a backend-neutral owner resolution. URL
// construction remains in Local's LSP server boundary.
type ExactPreviewLinkResult struct {
	Revision     transient.Revision
	Stamp        promptview.Stamp
	Kind         ExactPreviewLinkKind
	Reason       string
	DefinitionID string
}

// ExactPreviewLink projects the shared current owner-at-cursor proof onto the
// exact-preview link contract.
func (c *Controller) ExactPreviewLink(
	ctx context.Context,
	request LanguageRequest,
	position protocol.Position,
) ExactPreviewLinkResult {
	owner := c.ownerAt(ctx, request, position)
	result := ExactPreviewLinkResult{
		Revision: owner.Revision, Stamp: owner.Stamp,
		Reason: owner.Reason, DefinitionID: owner.DefinitionID,
	}
	switch owner.Kind {
	case OwnerAtReady:
		result.Kind = ExactPreviewLinkReady
	case OwnerAtStaticOnly:
		result.Kind = ExactPreviewLinkStaticOnly
	default:
		result.Kind = ExactPreviewLinkUnavailable
	}
	return result
}
