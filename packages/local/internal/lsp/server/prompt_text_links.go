package server

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type promptTextLinkWorkspace interface {
	PromptTextLinks(
		context.Context,
		protocol.DocumentURI,
		string,
	) lsprompttext.LinkResult
}

func (s *Server) promptTextLinks(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.DocumentLinkParams
	if json.Unmarshal(raw, &params) != nil || params.TextDocument.URI == "" {
		return invalidNavigationParams("document link")
	}
	empty := []protocol.DocumentLink{}
	document, ok := s.buffers.Snapshot(params.TextDocument.URI)
	if !ok {
		return jsonrpc.HandlerResult{Result: empty}
	}
	workspace, ok := s.currentWorkspace().(promptTextLinkWorkspace)
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
		result := workspace.PromptTextLinks(
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
		if result.Links == nil {
			result.Links = []protocol.DocumentLink{}
		}
		return jsonrpc.HandlerResult{Result: result.Links}
	}}
}
