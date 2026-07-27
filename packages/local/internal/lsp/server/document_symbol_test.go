package server

import (
	"context"
	"reflect"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
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
	if result.Error != nil || !ok || !reflect.DeepEqual(got, want) {
		t.Fatalf("document symbols = %#v, error = %#v", result.Result, result.Error)
	}
	if workspace.uri != uri {
		t.Fatalf("document symbol URI = %q, want %q", workspace.uri, uri)
	}
}

func TestDocumentSymbolHandlerComposesSavedAndPromptTextSymbols(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/writer.ts")
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 3,
		Text: "const value = md`# Heading`;\n",
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	saved := protocol.DocumentSymbol{
		Name: "value", Kind: protocol.SymbolKindObject,
		Range:          protocol.Range{Start: protocol.Position{Character: 6}},
		SelectionRange: protocol.Range{Start: protocol.Position{Character: 6}},
	}
	heading := protocol.DocumentSymbol{
		Name: "Heading", Kind: protocol.SymbolKindString,
		Range: protocol.Range{
			Start: protocol.Position{Character: 17},
			End:   protocol.Position{Character: 26},
		},
		SelectionRange: protocol.Range{
			Start: protocol.Position{Character: 19},
			End:   protocol.Position{Character: 26},
		},
	}
	workspace := &documentSymbolHandlerWorkspace{
		symbols: []protocol.DocumentSymbol{saved},
		promptText: lsprompttext.SymbolResult{
			Revision: document.Revision,
			Symbols:  []protocol.DocumentSymbol{heading},
		},
	}
	server.workspace = workspace

	result := server.Handle(context.Background(), protocol.Request{
		ID: []byte("2"), Method: protocol.MethodDocumentSymbol,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/writer.ts"}}`),
	})
	if result.Deferred == nil {
		t.Fatal("PromptText document-symbol analysis blocked the serial dispatcher")
	}
	result = result.Deferred()
	got, ok := result.Result.([]protocol.DocumentSymbol)
	if result.Error != nil || !ok ||
		!reflect.DeepEqual(got, []protocol.DocumentSymbol{saved, heading}) {
		t.Fatalf("document symbols = %#v, error = %#v", result.Result, result.Error)
	}
	if workspace.file != "/workspace/writer.ts" {
		t.Fatalf("PromptText file = %q, want /workspace/writer.ts", workspace.file)
	}

	workspace.promptText.Symbols = []protocol.DocumentSymbol{}
	result = server.Handle(context.Background(), protocol.Request{
		ID: []byte("3"), Method: protocol.MethodDocumentSymbol,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/writer.ts"}}`),
	})
	if result.Deferred == nil {
		t.Fatal("empty PromptText document-symbol analysis was not deferred")
	}
	result = result.Deferred()
	got, ok = result.Result.([]protocol.DocumentSymbol)
	if result.Error != nil || !ok ||
		!reflect.DeepEqual(got, []protocol.DocumentSymbol{saved}) {
		t.Fatalf("empty PromptText symbols = %#v; want saved symbol", result.Result)
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
	uri        protocol.DocumentURI
	file       string
	symbols    []protocol.DocumentSymbol
	promptText lsprompttext.SymbolResult
}

func (w *documentSymbolHandlerWorkspace) PromptTextSymbols(
	_ context.Context,
	_ protocol.DocumentURI,
	file string,
) lsprompttext.SymbolResult {
	w.file = file
	return w.promptText
}

func (w *documentSymbolHandlerWorkspace) DocumentSymbols(uri protocol.DocumentURI) []protocol.DocumentSymbol {
	w.uri = uri
	return w.symbols
}
