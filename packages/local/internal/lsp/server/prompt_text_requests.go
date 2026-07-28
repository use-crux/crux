package server

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

var (
	errPromptTextClientCancelled = errors.New("PromptText request cancelled by client")
	errPromptTextSuperseded      = errors.New("PromptText request superseded")
)

type pendingPromptText struct {
	cancel context.CancelCauseFunc
	key    string
	uri    protocol.DocumentURI
}

func (s *Server) registerPromptText(
	parent context.Context,
	id json.RawMessage,
	uri protocol.DocumentURI,
) (context.Context, *pendingPromptText) {
	ctx, cancel := context.WithCancelCause(parent)
	pending := &pendingPromptText{
		cancel: cancel, key: completionRequestKey(id), uri: uri,
	}
	s.promptTextMu.Lock()
	previousID := s.pendingPromptTexts[pending.key]
	s.pendingPromptTexts[pending.key] = pending
	requests := s.promptTextByURI[uri]
	if requests == nil {
		requests = make(map[*pendingPromptText]struct{})
		s.promptTextByURI[uri] = requests
	}
	requests[pending] = struct{}{}
	if previousID != nil {
		previousRequests := s.promptTextByURI[previousID.uri]
		delete(previousRequests, previousID)
		if len(previousRequests) == 0 {
			delete(s.promptTextByURI, previousID.uri)
		}
	}
	s.promptTextMu.Unlock()
	if previousID != nil {
		previousID.cancel(errPromptTextSuperseded)
	}
	return ctx, pending
}

func (s *Server) finishPromptText(pending *pendingPromptText) {
	s.promptTextMu.Lock()
	if s.pendingPromptTexts[pending.key] == pending {
		delete(s.pendingPromptTexts, pending.key)
	}
	requests := s.promptTextByURI[pending.uri]
	delete(requests, pending)
	if len(requests) == 0 {
		delete(s.promptTextByURI, pending.uri)
	}
	s.promptTextMu.Unlock()
	pending.cancel(nil)
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
		pending.cancel(errPromptTextClientCancelled)
	}
}

func (s *Server) cancelDocumentPromptText(uri protocol.DocumentURI) {
	s.promptTextMu.Lock()
	requests := s.promptTextByURI[uri]
	delete(s.promptTextByURI, uri)
	for pending := range requests {
		if s.pendingPromptTexts[pending.key] == pending {
			delete(s.pendingPromptTexts, pending.key)
		}
	}
	s.promptTextMu.Unlock()
	for pending := range requests {
		pending.cancel(errPromptTextSuperseded)
	}
}

func (s *Server) retireDocumentPromptText(uri protocol.DocumentURI) {
	s.cancelDocumentPromptText(uri)
	if s.promptText != nil {
		s.promptText.Invalidate(uri)
	}
}

func (s *Server) closePromptTextRequests() {
	s.promptTextMu.Lock()
	pending := s.pendingPromptTexts
	s.pendingPromptTexts = make(map[string]*pendingPromptText)
	s.promptTextByURI = make(
		map[protocol.DocumentURI]map[*pendingPromptText]struct{},
	)
	s.promptTextMu.Unlock()
	for _, request := range pending {
		request.cancel(errPromptTextSuperseded)
	}
	if s.promptText != nil {
		s.promptText.Close()
	}
}
