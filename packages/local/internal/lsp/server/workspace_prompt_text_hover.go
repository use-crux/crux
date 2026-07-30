package server

import (
	"context"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

// PromptTextHover pins one transformed semantic view and one current
// OWN/ATTACHED analyzer epoch for a hover request.
func (w *workspaceRuntime) PromptTextHover(
	ctx context.Context,
	uri protocol.DocumentURI,
	file string,
	position protocol.Position,
) lsprompttext.HoverResult {
	document, available := w.server.buffers.Snapshot(uri)
	if !available {
		return lsprompttext.HoverResult{}
	}
	empty := lsprompttext.HoverResult{Revision: document.Revision}
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
	result := w.server.promptText.Hover(
		queryContext,
		lsprompttext.LanguageRequest{
			URI: uri, File: file, ScopeID: scopeID,
			SourceEpoch: sourceEpoch, Analyzer: source, Views: views,
		},
		position,
	)
	if queryContext.Err() != nil ||
		!w.promptTextLanguageResultCurrent(
			session,
			uri,
			sourceEpoch,
			views,
			result.Revision,
			result.Stamp,
			result.ContributingFiles,
			result.Documents,
		) {
		empty.Handled = result.Handled
		return empty
	}
	return result
}
