package server

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func (s *Server) didOpen(raw json.RawMessage) {
	var params protocol.DidOpenTextDocumentParams
	if json.Unmarshal(raw, &params) != nil || params.TextDocument.URI == "" {
		return
	}
	s.traceDocumentBufferLimit(context.Background(), s.buffers.Open(params.TextDocument))
	s.setDocumentOpen(params.TextDocument.URI, true)
	if workspace := s.currentWorkspace(); workspace != nil {
		workspace.DidOpen(params.TextDocument.URI, params.TextDocument.Version)
	}
}

func (s *Server) didChange(raw json.RawMessage) {
	var params protocol.DidChangeTextDocumentParams
	if json.Unmarshal(raw, &params) != nil || params.TextDocument.URI == "" {
		return
	}
	s.cancelDocumentCompletion(params.TextDocument.URI)
	s.cancelDocumentPromptText(params.TextDocument.URI)
	_, notice := s.buffers.ApplyChanges(
		params.TextDocument.URI,
		params.TextDocument.Version,
		params.ContentChanges,
	)
	s.traceDocumentBufferLimit(context.Background(), notice)
	if workspace := s.currentWorkspace(); workspace != nil {
		workspace.DidChange(params.TextDocument.URI, params.TextDocument.Version, params.ContentChanges)
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
	s.cancelDocumentCompletion(params.TextDocument.URI)
	s.cancelDocumentPromptText(params.TextDocument.URI)
	s.buffers.Close(params.TextDocument.URI)
	s.setDocumentOpen(params.TextDocument.URI, false)
	if workspace := s.currentWorkspace(); workspace != nil {
		workspace.DidClose(params.TextDocument.URI)
	}
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
	previous := s.settings
	s.settings = mergeSettings(s.settings, params.Settings)
	settings := s.settings
	refreshInlayHints := previous.InlayHintsEnabled != settings.InlayHintsEnabled &&
		s.inlayHintRefreshSupport
	refreshCodeLens := previous.CodeLensEnabled != settings.CodeLensEnabled &&
		s.codeLensRefreshSupport
	workspace := s.workspace
	s.mu.Unlock()
	if workspace != nil {
		workspace.UpdateSettings(settings)
	}
	if refreshInlayHints {
		s.RequestClient(protocol.MethodInlayHintRefresh, nil)
	}
	if refreshCodeLens {
		s.requestCodeLensRefresh()
	}
}

func (s *Server) traceMethod(ctx context.Context, method string) {
	s.traceMessage(ctx, method)
}

func (s *Server) traceMessage(ctx context.Context, message string) {
	s.mu.Lock()
	enabled := s.settings.Trace == "messages"
	s.mu.Unlock()
	if enabled {
		s.Notify(ctx, protocol.MethodLogMessage, protocol.LogMessageParams{
			Type: protocol.MessageTypeLog, Message: message,
		})
	}
}

func (s *Server) traceDocumentBufferLimit(ctx context.Context, notice *documentBufferLimitNotice) {
	if notice == nil {
		return
	}
	uriHash := sha256.Sum256([]byte(notice.URI))
	s.traceMessage(ctx, fmt.Sprintf(
		"completion buffer unavailable uriHash=%x reason=%s documentBytes=%d processBytes=%d limitBytes=%d",
		uriHash[:8],
		notice.Reason,
		notice.DocumentBytes,
		notice.ProcessBytes,
		notice.LimitBytes,
	))
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
