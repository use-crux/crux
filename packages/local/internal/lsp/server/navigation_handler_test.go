package server

import (
	"context"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestDefinitionHandlerReturnsLocationAndNullMiss(t *testing.T) {
	t.Parallel()

	want := protocol.Location{
		URI: "file:///repo/target.ts",
		Range: protocol.Range{
			Start: protocol.Position{Line: 2, Character: 3},
			End:   protocol.Position{Line: 2, Character: 9},
		},
	}
	workspace := &navigationHandlerWorkspace{definition: want, definitionOK: true}
	server := New(Options{})
	server.workspace = workspace
	request := protocol.Request{
		ID: []byte("1"), Method: protocol.MethodDefinition,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/source.ts"},"position":{"line":4,"character":8}}`),
	}
	result := server.Handle(context.Background(), request)
	if result.Error != nil || !reflect.DeepEqual(result.Result, want) {
		t.Fatalf("definition result = %#v, error = %#v; want %#v", result.Result, result.Error, want)
	}
	if workspace.definitionURI != "file:///repo/source.ts" || workspace.definitionPosition != (protocol.Position{Line: 4, Character: 8}) {
		t.Fatalf("definition request = %q %#v", workspace.definitionURI, workspace.definitionPosition)
	}

	workspace.definitionOK = false
	result = server.Handle(context.Background(), request)
	if result.Error != nil || result.Result != nil {
		t.Fatalf("definition miss = %#v, error = %#v; want null", result.Result, result.Error)
	}
}

func TestReferencesHandlerReturnsLocationsAndEmptyArrayMiss(t *testing.T) {
	t.Parallel()

	want := []protocol.Location{{
		URI:   "file:///repo/reference.ts",
		Range: protocol.Range{Start: protocol.Position{Line: 6}, End: protocol.Position{Line: 7}},
	}}
	workspace := &navigationHandlerWorkspace{references: want}
	server := New(Options{})
	server.workspace = workspace
	request := protocol.Request{
		ID: []byte("1"), Method: protocol.MethodReferences,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/source.ts"},"position":{"line":4,"character":8},"context":{"includeDeclaration":true}}`),
	}
	result := server.Handle(context.Background(), request)
	if result.Error != nil || !reflect.DeepEqual(result.Result, want) {
		t.Fatalf("references result = %#v, error = %#v; want %#v", result.Result, result.Error, want)
	}
	if !workspace.includeDeclaration {
		t.Fatal("includeDeclaration was not forwarded")
	}

	workspace.references = nil
	result = server.Handle(context.Background(), request)
	locations, ok := result.Result.([]protocol.Location)
	if result.Error != nil || !ok || locations == nil || len(locations) != 0 {
		t.Fatalf("references miss = %#v, error = %#v; want non-nil empty slice", result.Result, result.Error)
	}
}

func TestNavigationHandlersRejectInvalidParams(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	for _, method := range []string{protocol.MethodDefinition, protocol.MethodReferences} {
		result := server.Handle(context.Background(), protocol.Request{ID: []byte("1"), Method: method, Params: []byte(`{}`)})
		if result.Error == nil || result.Error.Code != protocol.InvalidParamsCode {
			t.Fatalf("%s invalid params result = %#v", method, result)
		}
	}
}

type navigationHandlerWorkspace struct {
	workspaceController
	definition         protocol.Location
	definitionOK       bool
	definitionURI      protocol.DocumentURI
	definitionPosition protocol.Position
	references         []protocol.Location
	includeDeclaration bool
}

func (w *navigationHandlerWorkspace) DefinitionLocation(uri protocol.DocumentURI, position protocol.Position) (protocol.Location, bool) {
	w.definitionURI, w.definitionPosition = uri, position
	return w.definition, w.definitionOK
}

func (w *navigationHandlerWorkspace) ReferenceLocations(_ protocol.DocumentURI, _ protocol.Position, includeDeclaration bool) []protocol.Location {
	w.includeDeclaration = includeDeclaration
	return w.references
}
