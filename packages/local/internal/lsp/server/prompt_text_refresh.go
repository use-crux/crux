package server

import "github.com/use-crux/crux/packages/local/internal/lsp/protocol"

func promptTextRefreshSupport(capabilities *protocol.ClientCapabilities) bool {
	return capabilities != nil &&
		capabilities.Experimental != nil &&
		capabilities.Experimental.Crux != nil &&
		capabilities.Experimental.Crux.PromptText != nil &&
		capabilities.Experimental.Crux.PromptText.RefreshSupport
}

func (s *Server) requestPromptTextRefresh() {
	s.mu.Lock()
	supported := s.promptTextRefreshSupport
	s.mu.Unlock()
	if supported {
		s.RequestClient(
			protocol.MethodPromptTextRefresh,
			protocol.PromptTextRefreshParams{
				ProtocolVersion: protocol.PromptTextProtocolVersion,
			},
		)
	}
}
