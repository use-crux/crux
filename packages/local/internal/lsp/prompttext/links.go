package prompttext

import (
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// LinkResult retains the analyzed revision for the server's final staleness
// check. Links is always non-nil.
type LinkResult struct {
	Revision transient.Revision
	Links    []protocol.DocumentLink
}

func templateDocumentLinks(
	template staticprotocol.PromptTextTemplate,
	sourceFile string,
	scopeRoot string,
) []protocol.DocumentLink {
	if template.Status.Kind != staticprotocol.PromptTextStatusComplete {
		return []protocol.DocumentLink{}
	}
	links := make([]protocol.DocumentLink, 0)
	for _, link := range template.Links {
		if !validDocumentLinkRecord(template, link) {
			continue
		}
		target, ok := resolveLinkTarget(link.Destination, sourceFile, scopeRoot)
		if !ok {
			continue
		}
		links = append(links, protocol.DocumentLink{
			Range: editorRange(link.TextRange), Target: target,
		})
	}
	return links
}

func validDocumentLinkRecord(
	template staticprotocol.PromptTextTemplate,
	link staticprotocol.PromptTextLink,
) bool {
	if link.Kind != staticprotocol.PromptTextLinkInline &&
		link.Kind != staticprotocol.PromptTextLinkAutolink {
		return false
	}
	if !validStructureRange(template, link.Island, link.Range) ||
		!validStructureRange(template, link.Island, link.TextRange) ||
		!rangeContains(link.Range, link.TextRange) {
		return false
	}
	if link.Kind == staticprotocol.PromptTextLinkInline {
		return link.DestinationRange != nil &&
			validStructureRange(template, link.Island, *link.DestinationRange) &&
			rangeContains(link.Range, *link.DestinationRange)
	}
	return true
}

func rangeContains(
	outer staticprotocol.PromptTextRange,
	inner staticprotocol.PromptTextRange,
) bool {
	return comparePosition(outer.Start, inner.Start) <= 0 &&
		comparePosition(inner.End, outer.End) <= 0
}

func emptyLinkResult(revision transient.Revision) LinkResult {
	return LinkResult{Revision: revision, Links: []protocol.DocumentLink{}}
}
