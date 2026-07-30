package server

import (
	"context"
	"encoding/json"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextFoldingCapabilityAndHandler(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	initialize := server.Handle(context.Background(), protocol.Request{
		ID: []byte("1"), Method: protocol.MethodInitialize, Params: []byte(`{}`),
	})
	result, ok := initialize.Result.(protocol.InitializeResult)
	if !ok || !result.Capabilities.FoldingRangeProvider {
		t.Fatalf("capabilities = %#v, want foldingRangeProvider", initialize.Result)
	}

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 3,
		Text: "const value = md`# Title\nbody\n`;\n",
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	want := []protocol.FoldingRange{{StartLine: 0, EndLine: 1}}
	workspace := &promptTextFoldingHandlerWorkspace{result: lsprompttext.FoldingResult{
		Revision: document.Revision, Ranges: want,
	}}
	server.workspace = workspace

	response := server.Handle(context.Background(), protocol.Request{
		ID: []byte("2"), Method: protocol.MethodFoldingRange,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	if response.Deferred == nil {
		t.Fatal("folding analysis blocked the serial dispatcher")
	}
	response = response.Deferred()
	ranges, ok := response.Result.([]protocol.FoldingRange)
	if response.Error != nil || !ok || !equalServerFoldingRanges(ranges, want) {
		t.Fatalf("folding result = %#v, error = %#v; want %#v", response.Result, response.Error, want)
	}
	if workspace.uri != uri || workspace.file != "/repo/src/writer.ts" {
		t.Fatalf("folding target = (%q, %q), want (%q, %q)", workspace.uri, workspace.file, uri, "/repo/src/writer.ts")
	}
}

func TestPromptTextSharedAnalysisRequestsDoNotCancelSameRevision(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 3,
		Text: "const value = md`# Title\nbody\n`;\n",
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	server.workspace = &promptTextFoldingHandlerWorkspace{
		result: lsprompttext.FoldingResult{
			Revision: document.Revision,
			Ranges:   []protocol.FoldingRange{{StartLine: 0, EndLine: 1}},
		},
		decorations: lsprompttext.Result{
			Revision: document.Revision,
			Decorations: []lsprompttext.Decoration{{
				Role: lsprompttext.DecorationRoleHeading,
			}},
		},
		symbols: lsprompttext.SymbolResult{
			Revision: document.Revision,
			Symbols: []protocol.DocumentSymbol{{
				Name: "Title", Kind: protocol.SymbolKindString,
			}},
		},
		links: lsprompttext.LinkResult{
			Revision: document.Revision,
			Links: []protocol.DocumentLink{{
				Target: "https://example.com",
			}},
		},
	}
	decorationParams, err := json.Marshal(protocol.PromptTextDecorationParams{
		ProtocolVersion: protocol.PromptTextProtocolVersion,
		URI:             uri,
		OpenEpoch:       document.Revision.OpenEpoch,
		Version:         document.Revision.Version,
		SourceHash:      document.Revision.SourceHash,
	})
	if err != nil {
		t.Fatal(err)
	}
	decoration := server.Handle(context.Background(), protocol.Request{
		ID: []byte("10"), Method: protocol.MethodPromptTextDecorations,
		Params: decorationParams,
	})
	folding := server.Handle(context.Background(), protocol.Request{
		ID: []byte("11"), Method: protocol.MethodFoldingRange,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	symbols := server.Handle(context.Background(), protocol.Request{
		ID: []byte("12"), Method: protocol.MethodDocumentSymbol,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	links := server.Handle(context.Background(), protocol.Request{
		ID: []byte("13"), Method: protocol.MethodDocumentLink,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	if decoration.Deferred == nil || folding.Deferred == nil ||
		symbols.Deferred == nil || links.Deferred == nil {
		t.Fatal("overlapping PromptText requests were not all deferred")
	}

	decoration = decoration.Deferred()
	folding = folding.Deferred()
	symbols = symbols.Deferred()
	links = links.Deferred()
	decorated, decorationOK := decoration.Result.(protocol.PromptTextDecorationResult)
	folded, foldingOK := folding.Result.([]protocol.FoldingRange)
	if !decorationOK || len(decorated.Decorations) != 1 {
		t.Fatalf("decoration result = %#v, want one non-cancelled decoration", decoration.Result)
	}
	if !foldingOK || len(folded) != 1 {
		t.Fatalf("folding result = %#v, want one non-cancelled fold", folding.Result)
	}
	symbolsResult, symbolsOK := symbols.Result.([]protocol.DocumentSymbol)
	if !symbolsOK || len(symbolsResult) != 1 {
		t.Fatalf("symbol result = %#v, want one non-cancelled symbol", symbols.Result)
	}
	linksResult, linksOK := links.Result.([]protocol.DocumentLink)
	if !linksOK || len(linksResult) != 1 {
		t.Fatalf("link result = %#v, want one non-cancelled link", links.Result)
	}
}

func TestPromptTextFoldingCloseCancelsAndReturnsEmptyArray(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 3,
		Text: "const value = md`# Title\nbody\n`;\n",
	})
	workspace := &blockingPromptTextFoldingWorkspace{
		started: make(chan struct{}), cancelled: make(chan struct{}),
	}
	server.workspace = workspace
	response := server.Handle(context.Background(), protocol.Request{
		ID: []byte("20"), Method: protocol.MethodFoldingRange,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	if response.Deferred == nil {
		t.Fatal("folding request was not deferred")
	}
	done := make(chan jsonrpcResult, 1)
	go func() {
		deferred := response.Deferred()
		ranges, _ := deferred.Result.([]protocol.FoldingRange)
		done <- jsonrpcResult{ranges: ranges, err: deferred.Error}
	}()
	<-workspace.started

	server.Handle(context.Background(), protocol.Request{
		Method: protocol.MethodDidClose,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	<-workspace.cancelled
	result := <-done
	if result.err != nil || result.ranges == nil || len(result.ranges) != 0 {
		t.Fatalf("closed folding = %#v, error = %#v; want []", result.ranges, result.err)
	}
}

type promptTextFoldingHandlerWorkspace struct {
	workspaceController
	uri         protocol.DocumentURI
	file        string
	result      lsprompttext.FoldingResult
	decorations lsprompttext.Result
	symbols     lsprompttext.SymbolResult
	links       lsprompttext.LinkResult
}

func (*promptTextFoldingHandlerWorkspace) Close() {}

func (w *promptTextFoldingHandlerWorkspace) PromptTextFolding(
	_ context.Context,
	uri protocol.DocumentURI,
	file string,
) lsprompttext.FoldingResult {
	w.uri = uri
	w.file = file
	return w.result
}

func (w *promptTextFoldingHandlerWorkspace) PromptText(
	context.Context,
	protocol.DocumentURI,
	string,
) lsprompttext.Result {
	return w.decorations
}

func (w *promptTextFoldingHandlerWorkspace) PromptTextSymbols(
	context.Context,
	protocol.DocumentURI,
	string,
) lsprompttext.SymbolResult {
	return w.symbols
}

func (w *promptTextFoldingHandlerWorkspace) PromptTextLinks(
	context.Context,
	protocol.DocumentURI,
	string,
) lsprompttext.LinkResult {
	return w.links
}

type blockingPromptTextFoldingWorkspace struct {
	workspaceController
	started   chan struct{}
	cancelled chan struct{}
}

func (*blockingPromptTextFoldingWorkspace) Close()                        {}
func (*blockingPromptTextFoldingWorkspace) DidClose(protocol.DocumentURI) {}

func (w *blockingPromptTextFoldingWorkspace) PromptTextFolding(
	ctx context.Context,
	_ protocol.DocumentURI,
	_ string,
) lsprompttext.FoldingResult {
	close(w.started)
	<-ctx.Done()
	close(w.cancelled)
	return lsprompttext.FoldingResult{Ranges: []protocol.FoldingRange{}}
}

type jsonrpcResult struct {
	ranges []protocol.FoldingRange
	err    *protocol.ResponseError
}

func equalServerFoldingRanges(left, right []protocol.FoldingRange) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
