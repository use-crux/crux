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

type definitionWorkspace interface {
	DefinitionLocation(protocol.DocumentURI, protocol.Position) (protocol.Location, bool)
}

type referencesWorkspace interface {
	ReferenceLocations(protocol.DocumentURI, protocol.Position, bool) []protocol.Location
}

type promptTextNavigationWorkspace interface {
	PromptTextNavigation(
		context.Context,
		protocol.DocumentURI,
		string,
		protocol.Position,
		bool,
	) lsprompttext.NavigationResult
}

func (s *Server) definition(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.DefinitionParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return invalidNavigationParams("definition")
	}
	workspace := s.currentWorkspace()
	provider, promptTextSupported := workspace.(promptTextNavigationWorkspace)
	document, open := s.buffers.Snapshot(params.TextDocument.URI)
	file, fileErr := mapping.URIToPath(string(params.TextDocument.URI))
	if open && promptTextSupported && fileErr == nil {
		queryContext, pending := s.registerPromptText(ctx, id, params.TextDocument.URI)
		return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
			defer s.finishPromptText(pending)
			result := provider.PromptTextNavigation(
				queryContext,
				params.TextDocument.URI,
				file,
				params.Position,
				false,
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
			if result.Handled {
				if result.Definition == nil {
					return jsonrpc.HandlerResult{Result: nil}
				}
				return jsonrpc.HandlerResult{Result: *result.Definition}
			}
			return savedDefinition(workspace, params.TextDocument.URI, params.Position)
		}}
	}
	return savedDefinition(workspace, params.TextDocument.URI, params.Position)
}

func savedDefinition(
	workspace workspaceController,
	uri protocol.DocumentURI,
	position protocol.Position,
) jsonrpc.HandlerResult {
	provider, ok := workspace.(definitionWorkspace)
	if !ok {
		return jsonrpc.HandlerResult{Result: nil}
	}
	location, ok := provider.DefinitionLocation(uri, position)
	if !ok {
		return jsonrpc.HandlerResult{Result: nil}
	}
	return jsonrpc.HandlerResult{Result: location}
}

func (s *Server) references(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.ReferenceParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return invalidNavigationParams("references")
	}
	workspace := s.currentWorkspace()
	provider, promptTextSupported := workspace.(promptTextNavigationWorkspace)
	document, open := s.buffers.Snapshot(params.TextDocument.URI)
	file, fileErr := mapping.URIToPath(string(params.TextDocument.URI))
	if open && promptTextSupported && fileErr == nil {
		queryContext, pending := s.registerPromptText(ctx, id, params.TextDocument.URI)
		return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
			defer s.finishPromptText(pending)
			result := provider.PromptTextNavigation(
				queryContext,
				params.TextDocument.URI,
				file,
				params.Position,
				params.Context.IncludeDeclaration,
			)
			if errors.Is(context.Cause(queryContext), errPromptTextClientCancelled) {
				return cancelledPromptTextNavigation()
			}
			current, currentOK := s.buffers.Snapshot(params.TextDocument.URI)
			if queryContext.Err() != nil || !currentOK ||
				current.Revision != document.Revision ||
				result.Revision != current.Revision {
				return jsonrpc.HandlerResult{Result: []protocol.Location{}}
			}
			if result.Handled {
				if result.References == nil {
					result.References = []protocol.Location{}
				}
				return jsonrpc.HandlerResult{Result: result.References}
			}
			return savedReferences(
				workspace,
				params.TextDocument.URI,
				params.Position,
				params.Context.IncludeDeclaration,
			)
		}}
	}
	return savedReferences(
		workspace,
		params.TextDocument.URI,
		params.Position,
		params.Context.IncludeDeclaration,
	)
}

func savedReferences(
	workspace workspaceController,
	uri protocol.DocumentURI,
	position protocol.Position,
	includeDeclaration bool,
) jsonrpc.HandlerResult {
	locations := make([]protocol.Location, 0)
	if provider, ok := workspace.(referencesWorkspace); ok {
		locations = append(locations, provider.ReferenceLocations(
			uri,
			position,
			includeDeclaration,
		)...)
	}
	return jsonrpc.HandlerResult{Result: locations}
}

func cancelledPromptTextNavigation() jsonrpc.HandlerResult {
	return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
		Code: protocol.RequestCancelledCode, Message: "Request cancelled",
	}}
}

func invalidNavigationParams(method string) jsonrpc.HandlerResult {
	return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
		Code: protocol.InvalidParamsCode, Message: "Invalid " + method + " params",
	}}
}
