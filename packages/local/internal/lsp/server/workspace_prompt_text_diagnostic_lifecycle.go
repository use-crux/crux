package server

import (
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func (w *workspaceRuntime) openPromptTextDiagnostics(
	session *scopeSession,
	uri protocol.DocumentURI,
) {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	w.mu.Lock()
	delete(session.promptTextAcceptedViews, uri)
	delete(session.promptTextRetiredViews, uri)
	w.mu.Unlock()
	w.replacePromptTextDiagnostics(session, uri, true, true)
}

func (w *workspaceRuntime) savePromptTextDiagnostics(
	session *scopeSession,
	uri protocol.DocumentURI,
) {
	if w == nil || w.server == nil {
		return
	}
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	w.mu.Lock()
	accepted, ok := session.promptTextAcceptedViews[uri]
	delete(session.promptTextAcceptedViews, uri)
	if ok {
		if session.promptTextRetiredViews == nil {
			session.promptTextRetiredViews = make(
				map[protocol.DocumentURI]indexview.ViewStamp,
			)
		}
		session.promptTextRetiredViews[uri] = accepted
	} else {
		delete(session.promptTextRetiredViews, uri)
	}
	w.mu.Unlock()
	w.replacePromptTextDiagnostics(session, uri, true, true)
}

func (w *workspaceRuntime) closePromptTextDiagnostics(
	session *scopeSession,
	uri protocol.DocumentURI,
) {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	w.replacePromptTextDiagnostics(session, uri, false, true)
	w.mu.Lock()
	delete(session.promptTextAcceptedViews, uri)
	delete(session.promptTextRetiredViews, uri)
	w.mu.Unlock()
}
