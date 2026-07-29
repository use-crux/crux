package server

import (
	"context"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

// PromptTextExactPreviewLink pins the transformed semantic view and transient
// source epoch used to resolve one canonical Prompt owner.
func (w *workspaceRuntime) PromptTextExactPreviewLink(
	ctx context.Context,
	uri protocol.DocumentURI,
	file string,
	position protocol.Position,
) lsprompttext.ExactPreviewLinkResult {
	document, available := w.server.buffers.Snapshot(uri)
	if !available {
		return lsprompttext.ExactPreviewLinkResult{
			Kind:   lsprompttext.ExactPreviewLinkUnavailable,
			Reason: "analysis-unavailable",
		}
	}
	empty := lsprompttext.ExactPreviewLinkResult{
		Revision: document.Revision,
		Kind:     lsprompttext.ExactPreviewLinkUnavailable,
		Reason:   "analysis-unavailable",
	}
	session := w.navigationSession(uri)
	if session == nil {
		return empty
	}
	w.mu.Lock()
	if w.closed ||
		(session.mode != readmodel.ModeOwn && session.mode != readmodel.ModeAttached) ||
		session.transient == nil || session.promptTextViews == nil {
		w.mu.Unlock()
		return empty
	}
	source := session.transient
	sourceEpoch := session.sourceEpoch
	views := session.promptTextViews
	scopeID := session.scope.ID
	w.mu.Unlock()

	queryContext, cancel := context.WithTimeout(ctx, completionDeadline)
	defer cancel()
	result := w.server.promptText.ExactPreviewLink(
		queryContext,
		lsprompttext.LanguageRequest{
			URI: uri, File: file, ScopeID: scopeID,
			SourceEpoch: sourceEpoch, Analyzer: source, Views: views,
		},
		position,
	)
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	currentDocument, currentDocumentOK := w.server.buffers.Snapshot(uri)
	w.mu.Lock()
	current := !w.closed && currentDocumentOK &&
		currentDocument.Revision == result.Revision &&
		(session.mode == readmodel.ModeOwn || session.mode == readmodel.ModeAttached) &&
		session.sourceEpoch == sourceEpoch &&
		session.transient != nil &&
		session.promptTextViews == views
	w.mu.Unlock()
	if queryContext.Err() != nil || !current ||
		(result.Kind != lsprompttext.ExactPreviewLinkUnavailable &&
			!views.Current(result.Stamp)) {
		return empty
	}
	return result
}
