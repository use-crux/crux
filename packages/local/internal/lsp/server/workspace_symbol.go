package server

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const workspaceSymbolLimit = 200

type workspaceSymbolWorkspace interface {
	WorkspaceSymbols(string) ([]protocol.SymbolInformation, bool)
}

func (s *Server) workspaceSymbol(ctx context.Context, raw json.RawMessage) jsonrpc.HandlerResult {
	var wire struct {
		Query *string `json:"query"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil || wire.Query == nil {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code: protocol.InvalidParamsCode, Message: "Invalid workspace symbol params",
		}}
	}
	params := protocol.WorkspaceSymbolParams{Query: *wire.Query}
	symbols := make([]protocol.SymbolInformation, 0)
	if workspace, ok := s.currentWorkspace().(workspaceSymbolWorkspace); ok {
		var capped bool
		symbols, capped = workspace.WorkspaceSymbols(params.Query)
		if symbols == nil {
			symbols = make([]protocol.SymbolInformation, 0)
		}
		if capped {
			s.traceMessage(ctx, fmt.Sprintf("workspace/symbol results capped at %d", workspaceSymbolLimit))
		}
	}
	return jsonrpc.HandlerResult{Result: symbols}
}
