package server

import (
	"context"
	"reflect"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextDocumentSymbolsChangeRecomputesSavedFallback(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/writer.ts")
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const value = md`# Before`;\n",
	})
	saved := protocol.DocumentSymbol{
		Name: "value", Kind: protocol.SymbolKindObject,
		Range: protocol.Range{Start: protocol.Position{Character: 6}},
		SelectionRange: protocol.Range{
			Start: protocol.Position{Character: 6},
		},
	}
	shifted := saved
	shifted.Range.Start.Character = 8
	shifted.SelectionRange.Start.Character = 8
	workspace := &blockingDocumentSymbolWorkspace{
		saved:   []protocol.DocumentSymbol{saved},
		after:   []protocol.DocumentSymbol{shifted},
		started: make(chan struct{}), cancelled: make(chan struct{}),
	}
	server.workspace = workspace
	response := server.Handle(context.Background(), protocol.Request{
		ID: []byte("20"), Method: protocol.MethodDocumentSymbol,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/writer.ts"}}`),
	})
	if response.Deferred == nil {
		t.Fatal("PromptText document symbols were not deferred")
	}
	done := make(chan []protocol.DocumentSymbol, 1)
	go func() {
		result := response.Deferred()
		symbols, _ := result.Result.([]protocol.DocumentSymbol)
		done <- symbols
	}()
	<-workspace.started

	server.Handle(context.Background(), protocol.Request{
		Method: protocol.MethodDidChange,
		Params: []byte(`{
			"textDocument":{"uri":"file:///workspace/writer.ts","version":2},
			"contentChanges":[{"text":"const value = md` + "`" + `# After` + "`" + `;\n"}]
		}`),
	})
	<-workspace.cancelled
	if got := <-done; !reflect.DeepEqual(got, []protocol.DocumentSymbol{shifted}) {
		t.Fatalf("symbols after edit = %#v, want recomputed shifted fallback", got)
	}
}

func TestPromptTextDocumentSymbolsCancellationPreservesSavedSymbols(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/writer.ts")
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const value = md`# Before`;\n",
	})
	saved := protocol.DocumentSymbol{
		Name: "value", Kind: protocol.SymbolKindObject,
		Range:          protocol.Range{Start: protocol.Position{Character: 6}},
		SelectionRange: protocol.Range{Start: protocol.Position{Character: 6}},
	}
	workspace := &blockingDocumentSymbolWorkspace{
		saved:   []protocol.DocumentSymbol{saved},
		started: make(chan struct{}), cancelled: make(chan struct{}),
	}
	server.workspace = workspace
	ctx, cancel := context.WithCancel(context.Background())
	response := server.Handle(ctx, protocol.Request{
		ID: []byte("21"), Method: protocol.MethodDocumentSymbol,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/writer.ts"}}`),
	})
	if response.Deferred == nil {
		t.Fatal("PromptText document symbols were not deferred")
	}
	done := make(chan []protocol.DocumentSymbol, 1)
	go func() {
		result := response.Deferred()
		symbols, _ := result.Result.([]protocol.DocumentSymbol)
		done <- symbols
	}()
	<-workspace.started
	cancel()
	<-workspace.cancelled
	if got := <-done; !reflect.DeepEqual(got, []protocol.DocumentSymbol{saved}) {
		t.Fatalf("cancelled symbols = %#v, want saved fallback", got)
	}
}

type blockingDocumentSymbolWorkspace struct {
	workspaceController
	saved     []protocol.DocumentSymbol
	after     []protocol.DocumentSymbol
	started   chan struct{}
	cancelled chan struct{}
}

func (*blockingDocumentSymbolWorkspace) Close() {}

func (w *blockingDocumentSymbolWorkspace) DidChange(
	protocol.DocumentURI,
	int,
	[]protocol.TextDocumentContentChangeEvent,
) {
	if w.after != nil {
		w.saved = w.after
	}
}

func (w *blockingDocumentSymbolWorkspace) DocumentSymbols(
	protocol.DocumentURI,
) []protocol.DocumentSymbol {
	return w.saved
}

func (w *blockingDocumentSymbolWorkspace) PromptTextSymbols(
	ctx context.Context,
	_ protocol.DocumentURI,
	_ string,
) lsprompttext.SymbolResult {
	close(w.started)
	<-ctx.Done()
	close(w.cancelled)
	return lsprompttext.SymbolResult{Symbols: []protocol.DocumentSymbol{}}
}
