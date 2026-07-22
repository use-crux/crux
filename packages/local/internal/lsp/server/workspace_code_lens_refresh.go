package server

import (
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func (w *workspaceRuntime) setSessionMode(session *scopeSession, mode readmodel.Mode) {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	previous := session.mode
	session.mode = mode
	enabled := w.settings.CodeLensEnabled
	w.mu.Unlock()
	if enabled && (previous == readmodel.ModeAttached) != (mode == readmodel.ModeAttached) {
		w.server.requestCodeLensRefresh()
	}
}

func (w *workspaceRuntime) handleScopeChange(session *scopeSession, change readmodel.Change) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	session.publisher.Change(change)
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
}
