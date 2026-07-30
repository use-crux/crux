package prompttext

import (
	"context"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

// RefactorResult pins an optional ordinary-string action to both current
// document and transformed-view identities.
type RefactorResult struct {
	Revision transient.Revision
	Stamp    promptview.Stamp
	Actions  []protocol.CodeAction
}

// StringRefactor returns at most one byte-proven diagnostic-free rewrite.
func (c *Controller) StringRefactor(
	ctx context.Context,
	request LanguageRequest,
	requestRange protocol.Range,
) RefactorResult {
	for attempt := 0; attempt < 2; attempt++ {
		result, retry := c.stringRefactorAttempt(ctx, request, requestRange)
		if !retry {
			return result
		}
	}
	return RefactorResult{Actions: []protocol.CodeAction{}}
}

func (c *Controller) stringRefactorAttempt(
	ctx context.Context,
	request LanguageRequest,
	requestRange protocol.Range,
) (RefactorResult, bool) {
	empty := RefactorResult{Actions: []protocol.CodeAction{}}
	if c == nil || c.documents == nil || c.coordinator == nil ||
		request.Views == nil || request.Analyzer == nil || ctx.Err() != nil {
		return empty, false
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok {
		return empty, false
	}
	empty.Revision = document.Revision
	revision := indexview.DocumentRevision{
		OpenEpoch: document.Revision.OpenEpoch,
		Version:   document.Version, SourceHash: document.Revision.SourceHash,
	}
	selection := request.Views.Select(ctx, promptview.Request{
		ScopeID: request.ScopeID, File: request.File, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.RequireCurrent,
	})
	if selection.Status != indexview.ViewStatusExact || selection.View == nil {
		return empty, false
	}
	empty.Stamp = selection.View.Stamp
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch:    request.SourceEpoch,
		BaseGeneration: selection.View.Stamp.Project.BaseGeneration,
		ViewRevision:   selection.View.Stamp.Project.Revision,
		Analyzer:       request.Analyzer,
	})
	if err != nil || analysis.Revision != document.Revision {
		return empty, false
	}
	action, eligible := stringRefactorAt(
		selection.View,
		analysis.Result.Refactors,
		document,
		request.File,
		requestRange,
	)
	if !eligible {
		return empty, false
	}
	result := RefactorResult{
		Revision: document.Revision, Stamp: selection.View.Stamp,
		Actions: []protocol.CodeAction{action},
	}
	currentDocument, currentDocumentOK := c.documents.Snapshot(request.URI)
	if ctx.Err() != nil {
		return empty, false
	}
	if !currentDocumentOK || currentDocument.Revision != document.Revision ||
		!request.Views.Current(selection.View.Stamp) {
		return result, true
	}
	return result, false
}
