package server

import (
	"context"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

// PromptTextStaticPreview pins one OWN/ATTACHED analyzer epoch while deriving
// safe bytes from the shared current-buffer analysis.
func (w *workspaceRuntime) PromptTextStaticPreview(
	ctx context.Context,
	uri protocol.DocumentURI,
	file string,
	target lsprompttext.PreviewTarget,
) lsprompttext.PreviewResult {
	document, available := w.server.buffers.Snapshot(uri)
	if !available {
		return lsprompttext.PreviewResult{
			Kind:   lsprompttext.PreviewResultUnavailable,
			Reason: "analysis-unavailable",
		}
	}
	unavailable := lsprompttext.PreviewResult{
		Revision: document.Revision,
		Kind:     lsprompttext.PreviewResultUnavailable,
		Reason:   "analysis-unavailable",
	}
	session := w.navigationSession(uri)
	if session == nil {
		return unavailable
	}
	w.mu.Lock()
	if w.closed ||
		(session.mode != readmodel.ModeOwn && session.mode != readmodel.ModeAttached) ||
		session.transient == nil {
		w.mu.Unlock()
		return unavailable
	}
	source := session.transient
	sourceEpoch := session.sourceEpoch
	views := session.views
	scope := session.scope
	w.mu.Unlock()

	queryContext, cancel := context.WithTimeout(ctx, completionDeadline)
	defer cancel()
	result := w.server.promptText.StaticPreview(queryContext, lsprompttext.Request{
		URI: uri, File: file, Root: scope.Root, ScopeID: scope.ID,
		SourceEpoch: sourceEpoch, Analyzer: source, Views: views,
	}, target)
	w.mu.Lock()
	current := !w.closed &&
		(session.mode == readmodel.ModeOwn || session.mode == readmodel.ModeAttached) &&
		session.sourceEpoch == sourceEpoch
	w.mu.Unlock()
	if !current || queryContext.Err() != nil {
		return unavailable
	}
	return result
}
