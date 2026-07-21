package server

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func (s *Server) hover(raw json.RawMessage) jsonrpc.HandlerResult {
	var params protocol.HoverParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code: protocol.InvalidParamsCode, Message: "Invalid hover params",
		}}
	}
	workspace := s.currentWorkspace()
	if workspace == nil {
		return jsonrpc.HandlerResult{Result: nil}
	}
	findings := workspace.DisplayedFindings(params.TextDocument.URI, params.Position)
	if len(findings) == 0 {
		return jsonrpc.HandlerResult{Result: nil}
	}
	s.mu.Lock()
	format := s.hoverFormat
	s.mu.Unlock()
	return jsonrpc.HandlerResult{Result: buildHover(findings, format)}
}

func preferredHoverFormat(capabilities *protocol.ClientCapabilities) protocol.MarkupKind {
	if capabilities != nil && capabilities.TextDocument != nil && capabilities.TextDocument.Hover != nil {
		for _, format := range capabilities.TextDocument.Hover.ContentFormat {
			if format == protocol.MarkupKindMarkdown {
				return protocol.MarkupKindMarkdown
			}
		}
	}
	return protocol.MarkupKindPlainText
}
