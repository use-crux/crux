package server

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

type promptTextRefactorWorkspace interface {
	PromptTextStringRefactor(
		context.Context,
		protocol.DocumentURI,
		protocol.Range,
	) lsprompttext.RefactorResult
}

// PromptTextStringRefactor pins one current analyzer/source epoch around an
// exact transformed-view and Rust-proof query.
func (w *workspaceRuntime) PromptTextStringRefactor(
	ctx context.Context,
	uri protocol.DocumentURI,
	requestRange protocol.Range,
) lsprompttext.RefactorResult {
	empty := lsprompttext.RefactorResult{Actions: []protocol.CodeAction{}}
	document, available := w.server.buffers.Snapshot(uri)
	if !available {
		return empty
	}
	empty.Revision = document.Revision
	session := w.navigationSession(uri)
	if session == nil {
		return empty
	}
	file, err := mapping.URIToPath(string(uri))
	if err != nil {
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
	result := w.server.promptText.StringRefactor(
		queryContext,
		lsprompttext.LanguageRequest{
			URI: uri, File: file, ScopeID: scopeID,
			SourceEpoch: sourceEpoch, Analyzer: source, Views: views,
		},
		requestRange,
	)
	if queryContext.Err() != nil ||
		!w.promptTextLanguageResultCurrent(
			session,
			uri,
			sourceEpoch,
			views,
			result.Revision,
			result.Stamp,
			nil,
			nil,
		) {
		return empty
	}
	return result
}
