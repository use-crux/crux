package server

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type documentSymbolWorkspace interface {
	DocumentSymbols(protocol.DocumentURI) []protocol.DocumentSymbol
}

func (s *Server) documentSymbol(raw json.RawMessage) jsonrpc.HandlerResult {
	var params protocol.DocumentSymbolParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return invalidNavigationParams("document symbol")
	}
	symbols := make([]protocol.DocumentSymbol, 0)
	if workspace, ok := s.currentWorkspace().(documentSymbolWorkspace); ok {
		symbols = append(symbols, workspace.DocumentSymbols(params.TextDocument.URI)...)
	}
	return jsonrpc.HandlerResult{Result: symbols}
}
