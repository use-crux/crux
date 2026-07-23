package server

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestInitializeAdvertisesEagerCompletionWithMinimalTrigger(t *testing.T) {
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
	provider := initialize.Capabilities.CompletionProvider
	if provider.ResolveProvider {
		t.Fatal("completion resolve provider = true, want eager items")
	}
	if want := []string{":"}; !reflect.DeepEqual(provider.TriggerCharacters, want) {
		t.Fatalf("completion triggers = %v, want %v", provider.TriggerCharacters, want)
	}
}

func TestCompletionWithoutAvailableDocumentFailsSoft(t *testing.T) {
	t.Parallel()

	result := New(Options{}).Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodCompletion,
		Params: []byte(`{
			"textDocument":{"uri":"file:///workspace/src/agent.ts"},
			"position":{"line":2,"character":19}
		}`),
	})
	list, ok := result.Result.(protocol.CompletionList)
	if !ok {
		t.Fatalf("completion result = %#v, want protocol.CompletionList", result.Result)
	}
	if !list.IsIncomplete || list.Items == nil || len(list.Items) != 0 {
		t.Fatalf("completion list = %#v, want empty incomplete list", list)
	}
}

func TestCompletionMapsPinnedCompilerRecipeToEagerLSPItem(t *testing.T) {
	t.Parallel()
	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := &completionHandlerWorkspace{result: readmodel.CompletionResult{
		DocumentVersion: 4, Generation: 9,
		Items: []readmodel.CompletionItem{{
			ID: "prompt:writer", Kind: "prompt", Label: "writer",
			Detail: "prompt · prompt:writer", InsertText: "writer",
			Replacement: readmodel.CompletionRange{
				Start: readmodel.CompletionPosition{Line: 2, Character: 32},
				End:   readmodel.CompletionPosition{Line: 2, Character: 34},
			},
			AdditionalTextEdits: []readmodel.CompletionTextEdit{{
				Range: readmodel.CompletionRange{
					Start: readmodel.CompletionPosition{Line: 1, Character: 0},
					End:   readmodel.CompletionPosition{Line: 1, Character: 0},
				},
				NewText: "import { writer } from './writer'\n",
			}},
		}},
	}}
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 4,
		Text: "const writer = prompt({ id: 'writer' })\nconst x = 1\nconst support = agent({ prompt: wr",
	})

	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("7"), Method: protocol.MethodCompletion,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/src/agent.ts"},"position":{"line":2,"character":34}}`),
	})
	if result.Deferred == nil {
		t.Fatal("completion was not deferred")
	}
	result = result.Deferred()
	list := result.Result.(protocol.CompletionList)
	if list.IsIncomplete || len(list.Items) != 1 {
		t.Fatalf("completion list = %+v, want one complete item", list)
	}
	item := list.Items[0]
	if item.Label != "writer" || item.Kind != protocol.CompletionKindReference || item.TextEdit == nil || item.TextEdit.NewText != "writer" {
		t.Fatalf("completion item = %+v, want eager writer edit", item)
	}
	if len(item.AdditionalTextEdits) != 1 ||
		item.AdditionalTextEdits[0].Range.Start != (protocol.Position{Line: 1, Character: 0}) ||
		item.AdditionalTextEdits[0].NewText != "import { writer } from './writer'\n" {
		t.Fatalf("additional edits = %+v, want exact eager import edit", item.AdditionalTextEdits)
	}
	var data struct {
		DocumentVersion int    `json:"documentVersion"`
		IndexGeneration uint64 `json:"indexGeneration"`
		DefinitionID    string `json:"definitionId"`
	}
	if json.Unmarshal(item.Data, &data) != nil || data.DocumentVersion != 4 || data.IndexGeneration != 9 || data.DefinitionID != "prompt:writer" {
		t.Fatalf("completion data = %s, want V4/G9 identity", item.Data)
	}
}

func TestCancelRequestCancelsDeferredCompletion(t *testing.T) {
	t.Parallel()
	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := &completionHandlerWorkspace{started: make(chan struct{})}
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{URI: uri, LanguageID: "typescript", Version: 1, Text: "agent({ prompt: wr"})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("7"), Method: protocol.MethodCompletion,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/src/agent.ts"},"position":{"line":0,"character":18}}`),
	})
	if result.Deferred == nil {
		t.Fatal("completion was not deferred")
	}
	done := make(chan protocol.CompletionList, 1)
	go func() { done <- result.Deferred().Result.(protocol.CompletionList) }()
	<-workspace.started
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodCancelRequest, Params: []byte(`{"id":7}`),
	})
	list := <-done
	if !list.IsIncomplete || len(list.Items) != 0 {
		t.Fatalf("cancelled completion = %+v, want empty incomplete", list)
	}
}

func TestShutdownCancelsDeferredCompletionAndClearsSourceBuffer(t *testing.T) {
	t.Parallel()
	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := &completionHandlerWorkspace{started: make(chan struct{})}
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "agent({ prompt: privateUnsaved",
	})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("70"), Method: protocol.MethodCompletion,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/src/agent.ts"},"position":{"line":0,"character":31}}`),
	})
	done := make(chan protocol.CompletionList, 1)
	go func() { done <- result.Deferred().Result.(protocol.CompletionList) }()
	<-workspace.started
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("71"), Method: protocol.MethodShutdown,
	})
	list := <-done
	if !list.IsIncomplete || len(list.Items) != 0 {
		t.Fatalf("shutdown completion = %+v, want empty incomplete", list)
	}
	if _, ok := server.buffers.Snapshot(uri); ok {
		t.Fatal("shutdown retained unsaved completion source")
	}
}

func TestCompletionReturnsEmptyWhenDocumentChangesDuringQuery(t *testing.T) {
	t.Parallel()
	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := &completionHandlerWorkspace{
		started: make(chan struct{}), release: make(chan struct{}),
		result: readmodel.CompletionResult{DocumentVersion: 1, Generation: 3, Items: []readmodel.CompletionItem{{
			ID: "prompt:writer", Label: "writer", InsertText: "writer",
		}}},
	}
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{URI: uri, LanguageID: "typescript", Version: 1, Text: "agent({ prompt: wr"})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("8"), Method: protocol.MethodCompletion,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/src/agent.ts"},"position":{"line":0,"character":18}}`),
	})
	done := make(chan protocol.CompletionList, 1)
	go func() { done <- result.Deferred().Result.(protocol.CompletionList) }()
	<-workspace.started
	server.buffers.Change(uri, 2, []protocol.TextDocumentContentChangeEvent{{Text: "agent({ prompt: writer })"}})
	close(workspace.release)
	list := <-done
	if !list.IsIncomplete || len(list.Items) != 0 {
		t.Fatalf("stale document completion = %+v, want empty incomplete", list)
	}
}

type completionHandlerWorkspace struct {
	workspaceController
	result  readmodel.CompletionResult
	started chan struct{}
	release chan struct{}
	called  bool
}

func (*completionHandlerWorkspace) Close() {}

func (w *completionHandlerWorkspace) Completion(
	ctx context.Context,
	_ protocol.DocumentURI,
	_ readmodel.CompletionRequest,
) completionOutcome {
	w.called = true
	if w.started == nil {
		return completionOutcome{Kind: completionOutcomeCurrent, Result: w.result}
	}
	close(w.started)
	if w.release != nil {
		<-w.release
		return completionOutcome{Kind: completionOutcomeCurrent, Result: w.result}
	}
	<-ctx.Done()
	return completionOutcome{Kind: completionOutcomeSoft}
}
