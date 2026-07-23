package server

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type definitionHoverWorkspace interface {
	DefinitionSummaryAt(protocol.DocumentURI, protocol.Position) (definitionSummary, bool)
}

type coherentHoverWorkspace interface {
	HoverAt(protocol.DocumentURI, protocol.Position) ([]displayedFinding, *definitionSummary)
}

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
	var findings []displayedFinding
	var definition *definitionSummary
	if provider, ok := workspace.(coherentHoverWorkspace); ok {
		findings, definition = provider.HoverAt(params.TextDocument.URI, params.Position)
	} else {
		findings = workspace.DisplayedFindings(params.TextDocument.URI, params.Position)
		if provider, supported := workspace.(definitionHoverWorkspace); supported {
			if summary, found := provider.DefinitionSummaryAt(params.TextDocument.URI, params.Position); found {
				definition = &summary
			}
		}
	}
	if len(findings) == 0 && definition == nil {
		return jsonrpc.HandlerResult{Result: nil}
	}
	s.mu.Lock()
	format := s.hoverFormat
	s.mu.Unlock()
	return jsonrpc.HandlerResult{Result: buildHoverWithDefinition(findings, definition, format)}
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
