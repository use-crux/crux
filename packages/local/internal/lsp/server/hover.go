package server

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type definitionHoverWorkspace interface {
	DefinitionSummaryAt(protocol.DocumentURI, protocol.Position) (definitionSummary, bool)
}

type coherentHoverWorkspace interface {
	HoverAt(protocol.DocumentURI, protocol.Position) ([]displayedFinding, *definitionSummary)
}

type promptTextHoverWorkspace interface {
	PromptTextHover(
		context.Context,
		protocol.DocumentURI,
		string,
		protocol.Position,
	) lsprompttext.HoverResult
}

func (s *Server) hover(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
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
	s.mu.Lock()
	format := s.hoverFormat
	s.mu.Unlock()
	provider, supported := workspace.(promptTextHoverWorkspace)
	document, open := s.buffers.Snapshot(params.TextDocument.URI)
	file, fileErr := mapping.URIToPath(string(params.TextDocument.URI))
	if open && supported && fileErr == nil {
		queryContext, pending := s.registerPromptText(ctx, id, params.TextDocument.URI)
		return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
			defer s.finishPromptText(pending)
			result := provider.PromptTextHover(
				queryContext,
				params.TextDocument.URI,
				file,
				params.Position,
			)
			if errors.Is(context.Cause(queryContext), errPromptTextClientCancelled) {
				return cancelledPromptTextNavigation()
			}
			current, currentOK := s.buffers.Snapshot(params.TextDocument.URI)
			if queryContext.Err() != nil || !currentOK ||
				current.Revision != document.Revision ||
				result.Revision != current.Revision {
				return jsonrpc.HandlerResult{Result: nil}
			}
			if result.Claimed {
				findings := workspace.DisplayedFindings(
					params.TextDocument.URI,
					params.Position,
				)
				definition := promptTextDefinitionSummary(result.PromptTextHover)
				return jsonrpc.HandlerResult{Result: buildHoverWithPromptText(
					findings,
					definition,
					&result.PromptTextHover,
					format,
				)}
			}
			return savedHover(workspace, params, format)
		}}
	}
	return savedHover(workspace, params, format)
}

func savedHover(
	workspace workspaceController,
	params protocol.HoverParams,
	format protocol.MarkupKind,
) jsonrpc.HandlerResult {
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
