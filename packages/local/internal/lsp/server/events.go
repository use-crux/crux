package server

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func (s *Server) didOpen(raw json.RawMessage) {
	var params protocol.DidOpenTextDocumentParams
	if json.Unmarshal(raw, &params) != nil || params.TextDocument.URI == "" {
		return
	}
	s.setDocumentOpen(params.TextDocument.URI, true)
	if workspace := s.currentWorkspace(); workspace != nil {
		workspace.DidOpen(params.TextDocument.URI)
	}
}

func (s *Server) didSave(raw json.RawMessage) {
	var params protocol.DidSaveTextDocumentParams
	if json.Unmarshal(raw, &params) != nil || params.TextDocument.URI == "" {
		return
	}
	s.recordDocumentSave(params.TextDocument.URI)
	if workspace := s.currentWorkspace(); workspace != nil {
		workspace.DidSave(params.TextDocument.URI)
	}
}

func (s *Server) didClose(raw json.RawMessage) {
	var params protocol.DidCloseTextDocumentParams
	if json.Unmarshal(raw, &params) != nil || params.TextDocument.URI == "" {
		return
	}
	s.setDocumentOpen(params.TextDocument.URI, false)
}

func (s *Server) setDocumentOpen(uri protocol.DocumentURI, open bool) {
	s.mu.Lock()
	state := s.documents[uri]
	state.Open = open
	s.documents[uri] = state
	s.mu.Unlock()
}

func (s *Server) recordDocumentSave(uri protocol.DocumentURI) {
	savedAt := s.options.Now()
	s.mu.Lock()
	state := s.documents[uri]
	state.SavedAt = savedAt
	s.documents[uri] = state
	s.mu.Unlock()
}

func (s *Server) documentState(uri protocol.DocumentURI) (documentStatus, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, ok := s.documents[uri]
	return state, ok
}

func (s *Server) didChangeConfiguration(raw json.RawMessage) {
	var params protocol.DidChangeConfigurationParams
	if json.Unmarshal(raw, &params) != nil {
		return
	}
	s.mu.Lock()
	s.settings = mergeSettings(s.settings, params.Settings)
	settings := s.settings
	workspace := s.workspace
	s.mu.Unlock()
	if workspace != nil {
		workspace.UpdateSettings(settings)
	}
}

func (s *Server) traceMethod(ctx context.Context, method string) {
	s.mu.Lock()
	enabled := s.settings.Trace == "messages"
	s.mu.Unlock()
	if enabled {
		s.Notify(ctx, protocol.MethodLogMessage, protocol.LogMessageParams{
			Type: protocol.MessageTypeLog, Message: method,
		})
	}
}

func (s *Server) currentWorkspace() workspaceController {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspace
}

func (s *Server) closeWorkspace() {
	if workspace := s.currentWorkspace(); workspace != nil {
		workspace.Close()
	}
}
