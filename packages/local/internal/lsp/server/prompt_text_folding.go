package server

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type promptTextFoldingWorkspace interface {
	PromptTextFolding(
		context.Context,
		protocol.DocumentURI,
		string,
	) lsprompttext.FoldingResult
}

func (s *Server) promptTextFolding(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.FoldingRangeParams
	if json.Unmarshal(raw, &params) != nil || params.TextDocument.URI == "" {
		return invalidNavigationParams("folding range")
	}
	empty := []protocol.FoldingRange{}
	document, ok := s.buffers.Snapshot(params.TextDocument.URI)
	if !ok {
		return jsonrpc.HandlerResult{Result: empty}
	}
	workspace, ok := s.currentWorkspace().(promptTextFoldingWorkspace)
	if !ok {
		return jsonrpc.HandlerResult{Result: empty}
	}
	file, err := mapping.URIToPath(string(params.TextDocument.URI))
	if err != nil {
		return jsonrpc.HandlerResult{Result: empty}
	}
	queryContext, pending := s.registerPromptText(ctx, id, params.TextDocument.URI)
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.finishPromptText(pending)
		result := workspace.PromptTextFolding(
			queryContext,
			params.TextDocument.URI,
			file,
		)
		current, currentOK := s.buffers.Snapshot(params.TextDocument.URI)
		if queryContext.Err() != nil || !currentOK ||
			current.Revision != document.Revision ||
			result.Revision != current.Revision {
			return jsonrpc.HandlerResult{Result: empty}
		}
		if result.Ranges == nil {
			result.Ranges = []protocol.FoldingRange{}
		}
		return jsonrpc.HandlerResult{Result: result.Ranges}
	}}
}
