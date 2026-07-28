package prompttext

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

// HoverResult pins PromptText hover facts to the exact analyzed document.
type HoverResult struct {
	Revision          transient.Revision
	Stamp             view.Stamp
	ContributingFiles []string
	Documents         []view.DocumentStamp
	PromptTextHover
}

// Hover returns PromptText facts from the same transformed semantic selection
// used for its owner summary. It retries one final-stamp race.
func (c *Controller) Hover(
	ctx context.Context,
	request LanguageRequest,
	position protocol.Position,
) HoverResult {
	var last HoverResult
	for attempt := 0; attempt < 2; attempt++ {
		result, retry := c.hoverAttempt(ctx, request, position)
		if !retry {
			return result
		}
		last = result
	}
	last.PromptTextHover = PromptTextHover{Handled: last.Handled}
	return last
}

func (c *Controller) hoverAttempt(
	ctx context.Context,
	request LanguageRequest,
	position protocol.Position,
) (HoverResult, bool) {
	if c == nil || c.documents == nil || c.coordinator == nil ||
		request.Views == nil || request.Analyzer == nil || ctx.Err() != nil {
		return HoverResult{}, false
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok {
		return HoverResult{}, false
	}
	revision := indexview.DocumentRevision{
		OpenEpoch: document.Revision.OpenEpoch,
		Version:   document.Version, SourceHash: document.Revision.SourceHash,
	}
	selection := request.Views.Select(ctx, view.Request{
		ScopeID: request.ScopeID, File: request.File, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	if selection.Status == indexview.ViewStatusUnavailable || selection.View == nil {
		return HoverResult{Revision: document.Revision}, false
	}
	handled := len(refsAt(selection.View, request.File, position)) > 0
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch:    request.SourceEpoch,
		BaseGeneration: selection.View.Stamp.Project.BaseGeneration,
		ViewRevision:   selection.View.Stamp.Project.Revision,
		Analyzer:       request.Analyzer,
	})
	if err != nil || analysis.Revision != document.Revision {
		return HoverResult{
			Revision: document.Revision, Stamp: selection.View.Stamp,
			PromptTextHover: PromptTextHover{Handled: handled},
		}, false
	}
	hover := promptTextHoverAt(
		selection.View,
		analysis.Result,
		request.File,
		position,
		selection.Status,
	)
	result := HoverResult{
		Revision: document.Revision, Stamp: selection.View.Stamp,
		PromptTextHover: hover,
	}
	if hover.Claimed {
		refs := refsAt(selection.View, request.File, position)
		result.ContributingFiles, result.Documents = hoverDocumentStamps(
			selection.View,
			refs,
			occurrenceOwners(selection.View, refs),
		)
	}
	currentDocument, currentDocumentOK := c.documents.Snapshot(request.URI)
	if ctx.Err() != nil {
		return HoverResult{
			Revision: document.Revision, Stamp: selection.View.Stamp,
			PromptTextHover: PromptTextHover{Handled: handled},
		}, false
	}
	if !currentDocumentOK || currentDocument.Revision != document.Revision ||
		!request.Views.Current(selection.View.Stamp) {
		return result, true
	}
	return result, false
}
