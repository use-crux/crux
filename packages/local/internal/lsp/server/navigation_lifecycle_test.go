package server

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestInitializeAdvertisesNavigationProviders(t *testing.T) {
	t.Parallel()

	result := New(Options{}).Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params:  []byte(`{}`),
	})
	initialize, ok := result.Result.(protocol.InitializeResult)
	if !ok {
		t.Fatalf("initialize result = %#v, want protocol.InitializeResult", result.Result)
	}
	capabilities := initialize.Capabilities
	if !capabilities.DefinitionProvider {
		t.Error("definition provider was not advertised")
	}
	if !capabilities.ReferencesProvider {
		t.Error("references provider was not advertised")
	}
	if !capabilities.DocumentSymbolProvider {
		t.Error("document symbol provider was not advertised")
	}
	if !capabilities.WorkspaceSymbolProvider {
		t.Error("workspace symbol provider was not advertised")
	}
}

func TestNavigationMethodsAreClientRequests(t *testing.T) {
	t.Parallel()

	for _, method := range []string{
		protocol.MethodDefinition,
		protocol.MethodReferences,
		protocol.MethodDocumentSymbol,
		protocol.MethodWorkspaceSymbol,
	} {
		t.Run(method, func(t *testing.T) {
			if methodDirectionMatches(protocol.Request{Method: method}) {
				t.Fatal("notification direction accepted for request method")
			}
			if !methodDirectionMatches(protocol.Request{ID: []byte("1"), Method: method}) {
				t.Fatal("request direction rejected")
			}
		})
	}
}
