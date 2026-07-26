package server

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type pendingPromptText struct {
	cancel context.CancelFunc
	key    string
	uri    protocol.DocumentURI
}

func (s *Server) registerPromptText(
	parent context.Context,
	id json.RawMessage,
	uri protocol.DocumentURI,
) (context.Context, *pendingPromptText) {
	ctx, cancel := context.WithCancel(parent)
	pending := &pendingPromptText{
		cancel: cancel, key: completionRequestKey(id), uri: uri,
	}
	s.promptTextMu.Lock()
	previousID := s.pendingPromptTexts[pending.key]
	previousURI := s.promptTextByURI[uri]
	s.pendingPromptTexts[pending.key] = pending
	s.promptTextByURI[uri] = pending
	s.promptTextMu.Unlock()
	if previousID != nil {
		previousID.cancel()
	}
	if previousURI != nil && previousURI != previousID {
		previousURI.cancel()
	}
	return ctx, pending
}

func (s *Server) finishPromptText(pending *pendingPromptText) {
	s.promptTextMu.Lock()
	if s.pendingPromptTexts[pending.key] == pending {
		delete(s.pendingPromptTexts, pending.key)
	}
	if s.promptTextByURI[pending.uri] == pending {
		delete(s.promptTextByURI, pending.uri)
	}
	s.promptTextMu.Unlock()
	pending.cancel()
}

func (s *Server) cancelPromptTextRequest(raw json.RawMessage) {
	var params protocol.CancelParams
	if json.Unmarshal(raw, &params) != nil {
		return
	}
	s.promptTextMu.Lock()
	pending := s.pendingPromptTexts[completionRequestKey(params.ID)]
	s.promptTextMu.Unlock()
	if pending != nil {
		pending.cancel()
	}
}

func (s *Server) cancelDocumentPromptText(uri protocol.DocumentURI) {
	s.promptTextMu.Lock()
	pending := s.promptTextByURI[uri]
	if pending != nil {
		delete(s.promptTextByURI, uri)
	}
	s.promptTextMu.Unlock()
	if pending != nil {
		pending.cancel()
	}
}

func (s *Server) closePromptTextRequests() {
	s.promptTextMu.Lock()
	pending := s.pendingPromptTexts
	s.pendingPromptTexts = make(map[string]*pendingPromptText)
	s.promptTextByURI = make(map[protocol.DocumentURI]*pendingPromptText)
	s.promptTextMu.Unlock()
	for _, request := range pending {
		request.cancel()
	}
	if s.promptText != nil {
		s.promptText.Close()
	}
}
