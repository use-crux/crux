package server

import (
	"context"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

// PromptTextFolding pins one current OWN/ATTACHED analyzer epoch while
// projecting tag-neutral lexical folds. Saved semantic evidence is optional.
func (w *workspaceRuntime) PromptTextFolding(
	ctx context.Context,
	uri protocol.DocumentURI,
	file string,
) lsprompttext.FoldingResult {
	document, available := w.server.buffers.Snapshot(uri)
	if !available {
		return lsprompttext.FoldingResult{Ranges: []protocol.FoldingRange{}}
	}
	empty := lsprompttext.FoldingResult{
		Revision: document.Revision, Ranges: []protocol.FoldingRange{},
	}
	session := w.navigationSession(uri)
	if session == nil {
		return empty
	}
	w.mu.Lock()
	if w.closed ||
		(session.mode != readmodel.ModeOwn && session.mode != readmodel.ModeAttached) ||
		session.transient == nil {
		w.mu.Unlock()
		return empty
	}
	source := session.transient
	sourceEpoch := session.sourceEpoch
	views := session.views
	scope := session.scope
	w.mu.Unlock()

	queryContext, cancel := context.WithTimeout(ctx, completionDeadline)
	defer cancel()
	result := w.server.promptText.Folding(queryContext, lsprompttext.Request{
		URI: uri, File: file, Root: scope.Root, ScopeID: scope.ID,
		SourceEpoch: sourceEpoch, Analyzer: source, Views: views,
	})
	w.mu.Lock()
	current := !w.closed &&
		(session.mode == readmodel.ModeOwn || session.mode == readmodel.ModeAttached) &&
		session.sourceEpoch == sourceEpoch
	w.mu.Unlock()
	if !current || queryContext.Err() != nil {
		return empty
	}
	return result
}
