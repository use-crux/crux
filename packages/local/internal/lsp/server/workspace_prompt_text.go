package server

import (
	"context"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

// PromptText pins one scope and OWN/ATTACHED epoch around the shared
// tag-neutral analysis and semantic identity join.
func (w *workspaceRuntime) PromptText(
	ctx context.Context,
	uri protocol.DocumentURI,
	file string,
) lsprompttext.Result {
	document, available := w.server.buffers.Snapshot(uri)
	if !available {
		return lsprompttext.Result{Decorations: []lsprompttext.Decoration{}}
	}
	clear := lsprompttext.Result{
		Revision: document.Revision, Decorations: []lsprompttext.Decoration{},
	}
	session := w.navigationSession(uri)
	if session == nil {
		return clear
	}
	w.mu.Lock()
	if w.closed ||
		(session.mode != readmodel.ModeOwn && session.mode != readmodel.ModeAttached) ||
		session.transient == nil {
		w.mu.Unlock()
		return clear
	}
	source := session.transient
	sourceEpoch := session.sourceEpoch
	views := session.views
	scope := session.scope
	w.mu.Unlock()

	queryContext, cancel := context.WithTimeout(ctx, completionDeadline)
	defer cancel()
	result := w.server.promptText.Decorations(queryContext, lsprompttext.Request{
		URI: uri, File: file, Root: scope.Root, ScopeID: scope.ID,
		SourceEpoch: sourceEpoch, Analyzer: source, Views: views,
	})
	w.mu.Lock()
	current := !w.closed &&
		(session.mode == readmodel.ModeOwn || session.mode == readmodel.ModeAttached) &&
		session.sourceEpoch == sourceEpoch
	w.mu.Unlock()
	if !current || queryContext.Err() != nil {
		return clear
	}
	return result
}
