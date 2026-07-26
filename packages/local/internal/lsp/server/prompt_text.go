package server

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

type promptTextWorkspace interface {
	PromptText(context.Context, protocol.DocumentURI, string) lsprompttext.Result
}

func (s *Server) promptTextDecorations(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.PromptTextDecorationParams
	if json.Unmarshal(raw, &params) != nil ||
		params.ProtocolVersion != protocol.PromptTextProtocolVersion ||
		params.URI == "" || params.OpenEpoch == 0 || params.SourceHash == "" {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code: protocol.InvalidParamsCode, Message: "Invalid PromptText decoration params",
		}}
	}
	clear := clearPromptTextResult(params)
	document, ok := s.buffers.Snapshot(params.URI)
	if !ok || document.Revision != promptTextRevision(params) {
		return jsonrpc.HandlerResult{Result: clear}
	}
	workspace, ok := s.currentWorkspace().(promptTextWorkspace)
	if !ok {
		return jsonrpc.HandlerResult{Result: clear}
	}
	file, err := mapping.URIToPath(string(params.URI))
	if err != nil {
		return jsonrpc.HandlerResult{Result: clear}
	}
	queryContext, pending := s.registerPromptText(ctx, id, params.URI)
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.finishPromptText(pending)
		result := workspace.PromptText(queryContext, params.URI, file)
		current, currentOK := s.buffers.Snapshot(params.URI)
		if queryContext.Err() != nil || !currentOK ||
			current.Revision != promptTextRevision(params) ||
			result.Revision != current.Revision {
			return jsonrpc.HandlerResult{Result: clear}
		}
		decorations := result.Decorations
		if decorations == nil {
			decorations = []protocol.PromptTextDecoration{}
		}
		return jsonrpc.HandlerResult{Result: protocol.PromptTextDecorationResult{
			ProtocolVersion: protocol.PromptTextProtocolVersion,
			URI:             params.URI, OpenEpoch: params.OpenEpoch,
			Version: params.Version, SourceHash: params.SourceHash,
			Decorations: decorations,
		}}
	}}
}

func promptTextRevision(params protocol.PromptTextDecorationParams) transient.Revision {
	return transient.Revision{
		OpenEpoch: params.OpenEpoch, Version: params.Version, SourceHash: params.SourceHash,
	}
}

func clearPromptTextResult(
	params protocol.PromptTextDecorationParams,
) protocol.PromptTextDecorationResult {
	return protocol.PromptTextDecorationResult{
		ProtocolVersion: protocol.PromptTextProtocolVersion,
		URI:             params.URI, OpenEpoch: params.OpenEpoch,
		Version: params.Version, SourceHash: params.SourceHash,
		Decorations: []protocol.PromptTextDecoration{},
	}
}
