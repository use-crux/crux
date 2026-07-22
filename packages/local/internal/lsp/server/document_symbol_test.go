package server

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestDocumentSymbolHandlerForwardsDocumentURI(t *testing.T) {
	t.Parallel()

	want := []protocol.DocumentSymbol{{
		Name: "writer", Detail: "prompt", Kind: protocol.SymbolKindFunction,
		Range:          protocol.Range{Start: protocol.Position{Line: 4, Character: 28}},
		SelectionRange: protocol.Range{Start: protocol.Position{Line: 4, Character: 28}},
	}}
	workspace := &documentSymbolHandlerWorkspace{symbols: want}
	server := New(Options{})
	server.workspace = workspace
	uri := protocol.DocumentURI("file:///workspace/writer.ts")
	result := server.Handle(context.Background(), protocol.Request{
		ID: []byte("1"), Method: protocol.MethodDocumentSymbol,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/writer.ts"}}`),
	})

	got, ok := result.Result.([]protocol.DocumentSymbol)
	if result.Error != nil || !ok || len(got) != 1 || got[0] != want[0] {
		t.Fatalf("document symbols = %#v, error = %#v", result.Result, result.Error)
	}
	if workspace.uri != uri {
		t.Fatalf("document symbol URI = %q, want %q", workspace.uri, uri)
	}
}

func TestDocumentSymbolHandlerReturnsEmptyArrayOnMiss(t *testing.T) {
	t.Parallel()

	requests := []*Server{New(Options{}), New(Options{})}
	requests[1].workspace = &documentSymbolHandlerWorkspace{}
	for _, server := range requests {
		result := server.Handle(context.Background(), protocol.Request{
			ID: []byte("1"), Method: protocol.MethodDocumentSymbol,
			Params: []byte(`{"textDocument":{"uri":"file:///workspace/missing.ts"}}`),
		})
		got, ok := result.Result.([]protocol.DocumentSymbol)
		if result.Error != nil || !ok || got == nil || len(got) != 0 {
			t.Fatalf("document symbol miss = %#v, error = %#v; want []", result.Result, result.Error)
		}
	}
}

func TestDocumentSymbolHandlerRequiresDocumentURI(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	for _, raw := range []string{"null", `{}`, `{"textDocument":{}}`, `{"textDocument":{"uri":""}}`} {
		result := server.Handle(context.Background(), protocol.Request{
			ID: []byte("1"), Method: protocol.MethodDocumentSymbol, Params: []byte(raw),
		})
		if result.Error == nil || result.Error.Code != protocol.InvalidParamsCode {
			t.Errorf("params %s result = %#v, want InvalidParams", raw, result)
		}
	}
}

type documentSymbolHandlerWorkspace struct {
	workspaceController
	uri     protocol.DocumentURI
	symbols []protocol.DocumentSymbol
}

func (w *documentSymbolHandlerWorkspace) DocumentSymbols(uri protocol.DocumentURI) []protocol.DocumentSymbol {
	w.uri = uri
	return w.symbols
}
