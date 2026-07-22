package server

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type definitionWorkspace interface {
	DefinitionLocation(protocol.DocumentURI, protocol.Position) (protocol.Location, bool)
}

type referencesWorkspace interface {
	ReferenceLocations(protocol.DocumentURI, protocol.Position, bool) []protocol.Location
}

func (s *Server) definition(raw json.RawMessage) jsonrpc.HandlerResult {
	var params protocol.DefinitionParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return invalidNavigationParams("definition")
	}
	workspace, ok := s.currentWorkspace().(definitionWorkspace)
	if !ok {
		return jsonrpc.HandlerResult{Result: nil}
	}
	location, ok := workspace.DefinitionLocation(params.TextDocument.URI, params.Position)
	if !ok {
		return jsonrpc.HandlerResult{Result: nil}
	}
	return jsonrpc.HandlerResult{Result: location}
}

func (s *Server) references(raw json.RawMessage) jsonrpc.HandlerResult {
	var params protocol.ReferenceParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return invalidNavigationParams("references")
	}
	locations := make([]protocol.Location, 0)
	if workspace, ok := s.currentWorkspace().(referencesWorkspace); ok {
		locations = append(locations, workspace.ReferenceLocations(
			params.TextDocument.URI,
			params.Position,
			params.Context.IncludeDeclaration,
		)...)
	}
	return jsonrpc.HandlerResult{Result: locations}
}

func invalidNavigationParams(method string) jsonrpc.HandlerResult {
	return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
		Code: protocol.InvalidParamsCode, Message: "Invalid " + method + " params",
	}}
}
