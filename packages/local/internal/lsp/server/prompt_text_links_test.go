package server

import (
	"context"
	"encoding/json"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextDocumentLinkCapabilityAndEagerHandler(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	initialize := server.Handle(context.Background(), protocol.Request{
		ID: []byte("1"), Method: protocol.MethodInitialize, Params: []byte(`{}`),
	})
	result, ok := initialize.Result.(protocol.InitializeResult)
	if !ok || result.Capabilities.DocumentLinkProvider.ResolveProvider {
		t.Fatalf(
			"capabilities = %#v, want documentLinkProvider.resolveProvider false",
			initialize.Result,
		)
	}

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 3,
		Text: "const value = md`[guide](https://example.com)`;\n",
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	want := []protocol.DocumentLink{{
		Range: protocol.Range{
			Start: protocol.Position{Character: 18},
			End:   protocol.Position{Character: 23},
		},
		Target: "https://example.com",
	}}
	workspace := &promptTextLinkHandlerWorkspace{result: lsprompttext.LinkResult{
		Revision: document.Revision, Links: want,
	}}
	server.workspace = workspace

	response := server.Handle(context.Background(), protocol.Request{
		ID: []byte("2"), Method: protocol.MethodDocumentLink,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	if response.Deferred == nil {
		t.Fatal("document-link analysis blocked the serial dispatcher")
	}
	response = response.Deferred()
	links, ok := response.Result.([]protocol.DocumentLink)
	if response.Error != nil || !ok || !equalServerDocumentLinks(links, want) {
		t.Fatalf(
			"document links = %#v, error = %#v; want %#v",
			response.Result,
			response.Error,
			want,
		)
	}
	if workspace.uri != uri || workspace.file != "/repo/src/writer.ts" {
		t.Fatalf(
			"document-link target = (%q, %q), want (%q, %q)",
			workspace.uri,
			workspace.file,
			uri,
			"/repo/src/writer.ts",
		)
	}
	encoded, err := json.Marshal(links[0])
	if err != nil {
		t.Fatal(err)
	}
	const eagerWire = `{"range":{"start":{"line":0,"character":18},"end":{"line":0,"character":23}},"target":"https://example.com"}`
	if string(encoded) != eagerWire {
		t.Fatalf("document-link wire = %s, want %s", encoded, eagerWire)
	}
}

func TestPromptTextDoesNotRegisterDocumentLinkResolve(t *testing.T) {
	t.Parallel()

	result := New(Options{}).Handle(context.Background(), protocol.Request{
		ID: []byte("1"), Method: "documentLink/resolve", Params: []byte(`{}`),
	})
	if result.Error == nil || result.Error.Code != protocol.MethodNotFoundCode {
		t.Fatalf("resolve result = %#v, want method not found", result)
	}
}

func TestPromptTextDocumentLinkCloseCancelsAndReturnsEmptyArray(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const value = md`[guide](https://example.com)`;\n",
	})
	workspace := &blockingPromptTextLinkWorkspace{
		started: make(chan struct{}), cancelled: make(chan struct{}),
	}
	server.workspace = workspace
	response := server.Handle(context.Background(), protocol.Request{
		ID: []byte("20"), Method: protocol.MethodDocumentLink,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	if response.Deferred == nil {
		t.Fatal("document-link request was not deferred")
	}
	done := make(chan []protocol.DocumentLink, 1)
	go func() {
		deferred := response.Deferred()
		links, _ := deferred.Result.([]protocol.DocumentLink)
		done <- links
	}()
	<-workspace.started

	server.Handle(context.Background(), protocol.Request{
		Method: protocol.MethodDidClose,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	<-workspace.cancelled
	links := <-done
	if links == nil || len(links) != 0 {
		t.Fatalf("closed document links = %#v, want []", links)
	}
}

func TestPromptTextDocumentLinkChangeRejectsSupersededResult(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const value = md`[before](https://example.com)`;\n",
	})
	workspace := &blockingPromptTextLinkWorkspace{
		started: make(chan struct{}), cancelled: make(chan struct{}),
	}
	server.workspace = workspace
	response := server.Handle(context.Background(), protocol.Request{
		ID: []byte("21"), Method: protocol.MethodDocumentLink,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	})
	done := make(chan []protocol.DocumentLink, 1)
	go func() {
		deferred := response.Deferred()
		links, _ := deferred.Result.([]protocol.DocumentLink)
		done <- links
	}()
	<-workspace.started

	server.Handle(context.Background(), protocol.Request{
		Method: protocol.MethodDidChange,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/src/writer.ts","version":2},
			"contentChanges":[{"text":"const value = md` + "`" + `[after](https://example.com)` + "`" + `;\n"}]
		}`),
	})
	<-workspace.cancelled
	links := <-done
	if links == nil || len(links) != 0 {
		t.Fatalf("superseded document links = %#v, want []", links)
	}
}

type promptTextLinkHandlerWorkspace struct {
	workspaceController
	uri    protocol.DocumentURI
	file   string
	result lsprompttext.LinkResult
}

func (*promptTextLinkHandlerWorkspace) Close() {}

func (w *promptTextLinkHandlerWorkspace) PromptTextLinks(
	_ context.Context,
	uri protocol.DocumentURI,
	file string,
) lsprompttext.LinkResult {
	w.uri = uri
	w.file = file
	return w.result
}

func equalServerDocumentLinks(left, right []protocol.DocumentLink) bool {
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

type blockingPromptTextLinkWorkspace struct {
	workspaceController
	started   chan struct{}
	cancelled chan struct{}
}

func (*blockingPromptTextLinkWorkspace) Close()                        {}
func (*blockingPromptTextLinkWorkspace) DidClose(protocol.DocumentURI) {}
func (*blockingPromptTextLinkWorkspace) DidChange(
	protocol.DocumentURI,
	int,
	[]protocol.TextDocumentContentChangeEvent,
) {
}

func (w *blockingPromptTextLinkWorkspace) PromptTextLinks(
	ctx context.Context,
	_ protocol.DocumentURI,
	_ string,
) lsprompttext.LinkResult {
	close(w.started)
	<-ctx.Done()
	close(w.cancelled)
	return lsprompttext.LinkResult{Links: []protocol.DocumentLink{}}
}
