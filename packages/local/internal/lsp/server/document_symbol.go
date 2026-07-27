package server

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type documentSymbolWorkspace interface {
	DocumentSymbols(protocol.DocumentURI) []protocol.DocumentSymbol
}

type promptTextSymbolWorkspace interface {
	PromptTextSymbols(
		context.Context,
		protocol.DocumentURI,
		string,
	) lsprompttext.SymbolResult
}

func (s *Server) documentSymbol(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.DocumentSymbolParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return invalidNavigationParams("document symbol")
	}
	workspace := s.currentWorkspace()
	document, open := s.buffers.Snapshot(params.TextDocument.URI)
	promptText, supported := workspace.(promptTextSymbolWorkspace)
	if !open || !supported {
		return jsonrpc.HandlerResult{
			Result: savedDocumentSymbols(workspace, params.TextDocument.URI),
		}
	}
	file, err := mapping.URIToPath(string(params.TextDocument.URI))
	if err != nil {
		return jsonrpc.HandlerResult{
			Result: savedDocumentSymbols(workspace, params.TextDocument.URI),
		}
	}
	queryContext, pending := s.registerPromptText(ctx, id, params.TextDocument.URI)
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.finishPromptText(pending)
		result := promptText.PromptTextSymbols(
			queryContext,
			params.TextDocument.URI,
			file,
		)
		current, currentOK := s.buffers.Snapshot(params.TextDocument.URI)
		if queryContext.Err() != nil || !currentOK ||
			current.Revision != document.Revision ||
			result.Revision != current.Revision {
			return jsonrpc.HandlerResult{
				Result: savedDocumentSymbols(workspace, params.TextDocument.URI),
			}
		}
		symbols := savedDocumentSymbols(workspace, params.TextDocument.URI)
		return jsonrpc.HandlerResult{
			Result: append(symbols, result.Symbols...),
		}
	}}
}

func savedDocumentSymbols(
	workspace workspaceController,
	uri protocol.DocumentURI,
) []protocol.DocumentSymbol {
	symbols := make([]protocol.DocumentSymbol, 0)
	if workspace, ok := workspace.(documentSymbolWorkspace); ok {
		symbols = append(symbols, workspace.DocumentSymbols(uri)...)
	}
	return symbols
}
