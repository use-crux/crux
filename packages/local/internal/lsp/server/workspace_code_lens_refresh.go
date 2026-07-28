package server

import (
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func (w *workspaceRuntime) setSessionMode(session *scopeSession, mode readmodel.Mode) {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()

	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	previous := session.mode
	if previous == mode {
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()

	uris := w.retireOpenPromptTextDiagnostics(session)
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	session.mode = mode
	session.sourceEpoch++
	session.completionFailures = 0
	enabled := w.settings.CodeLensEnabled
	w.mu.Unlock()
	if enabled && (previous == readmodel.ModeAttached) != (mode == readmodel.ModeAttached) {
		w.server.requestCodeLensRefresh()
	}
	if w.server != nil {
		w.server.requestPromptTextRefresh()
		w.resumeOpenPromptTextDiagnostics(session, uris)
	}
}

func (w *workspaceRuntime) setSessionTransientSource(session *scopeSession, source readmodel.TransientSource) {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()

	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()

	uris := w.retireOpenPromptTextDiagnostics(session)
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	session.transient = source
	session.sourceEpoch++
	session.completionFailures = 0
	w.mu.Unlock()
	if w.server != nil {
		w.server.requestPromptTextRefresh()
		w.resumeOpenPromptTextDiagnostics(session, uris)
	}
}

func (w *workspaceRuntime) handleScopeChange(session *scopeSession, change readmodel.Change) {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()

	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()
	session.publisher.Change(change)
	w.resetOpenPromptTextDiagnostics(session, change.Files)
}

func (w *workspaceRuntime) invalidateTransientSource(session *scopeSession) {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()

	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()

	uris := w.retireOpenPromptTextDiagnostics(session)
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	session.sourceEpoch++
	session.completionFailures = 0
	w.mu.Unlock()
	if w.server != nil {
		w.server.requestPromptTextRefresh()
		w.resumeOpenPromptTextDiagnostics(session, uris)
	}
}

func (s *Server) requestCodeLensRefresh() {
	s.mu.Lock()
	supported := s.codeLensRefreshSupport
	s.mu.Unlock()
	if supported {
		s.RequestClient(protocol.MethodCodeLensRefresh, nil)
	}
}

func (s *Server) requestCodeLensRefreshIfEnabled() {
	s.mu.Lock()
	enabled := s.settings.CodeLensEnabled
	s.mu.Unlock()
	if enabled {
		s.requestCodeLensRefresh()
	}
}

func (s *Server) requestInlayHintRefresh() {
	s.mu.Lock()
	supported := s.inlayHintRefreshSupport
	s.mu.Unlock()
	if supported {
		s.RequestClient(protocol.MethodInlayHintRefresh, nil)
	}
}

func (s *Server) requestInlayHintRefreshIfEnabled() {
	s.mu.Lock()
	enabled := s.settings.InlayHintsEnabled
	s.mu.Unlock()
	if enabled {
		s.requestInlayHintRefresh()
	}
}

// requestEditorAnnotationsRefreshIfEnabled invalidates every annotation whose
// content derives from the newly coherent displayed publication.
func (s *Server) requestEditorAnnotationsRefreshIfEnabled() {
	s.requestInlayHintRefreshIfEnabled()
	s.requestCodeLensRefreshIfEnabled()
	s.requestPromptTextRefresh()
}
