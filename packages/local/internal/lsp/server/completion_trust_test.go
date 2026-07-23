package server

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestCompletionRequiresTrustBeforeInitialize(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := &completionHandlerWorkspace{}
	server := New(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "agent({ prompt: wr",
	})

	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodCompletion,
		Params:  []byte(`{"textDocument":{"uri":"file:///workspace/src/agent.ts"},"position":{"line":0,"character":19}}`),
	})
	if result.Deferred != nil {
		t.Fatal("completion without an initialize-time trust signal reached the workspace")
	}
	if workspace.called {
		t.Fatal("completion without an initialize-time trust signal read unsaved source")
	}
}

func TestCompletionDoesNotReadUntrustedUnsavedSource(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := &completionHandlerWorkspace{}
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.trusted = false
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 4,
		Text: "const privateSecret = agent({ prompt: wr",
	})

	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("2"), Method: protocol.MethodCompletion,
		Params: []byte(`{"textDocument":{"uri":"file:///workspace/src/agent.ts"},"position":{"line":0,"character":40}}`),
	})
	list, ok := result.Result.(protocol.CompletionList)
	if !ok || !list.IsIncomplete || len(list.Items) != 0 {
		t.Fatalf("completion result = %#v, want immediate empty list", result.Result)
	}
	if workspace.called {
		t.Fatal("untrusted completion queried the workspace with unsaved source")
	}
}

func TestInitializeRequiresExplicitWorkspaceTrustForCompletion(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		params   string
		wantCall bool
	}{
		{name: "absent options", params: `{}`},
		{name: "missing signal", params: `{"initializationOptions":{}}`},
		{name: "malformed signal", params: `{"initializationOptions":{"workspaceTrust":"yes"}}`},
		{name: "explicit untrusted", params: `{"initializationOptions":{"workspaceTrust":false}}`},
		{name: "explicit trusted", params: `{"initializationOptions":{"workspaceTrust":true}}`, wantCall: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
			workspace := &completionHandlerWorkspace{}
			server := New(Options{})
			server.workspace = workspace
			server.buffers.Open(protocol.TextDocumentItem{
				URI: uri, LanguageID: "typescript", Version: 1,
				Text: "agent({ prompt: wr",
			})
			server.Handle(context.Background(), protocol.Request{
				JSONRPC: protocol.JSONRPCVersion,
				ID:      []byte("1"),
				Method:  protocol.MethodInitialize,
				Params:  []byte(test.params),
			})
			result := server.Handle(context.Background(), protocol.Request{
				JSONRPC: protocol.JSONRPCVersion,
				ID:      []byte("2"),
				Method:  protocol.MethodCompletion,
				Params:  []byte(`{"textDocument":{"uri":"file:///workspace/src/agent.ts"},"position":{"line":0,"character":19}}`),
			})
			if result.Deferred != nil {
				result.Deferred()
			}
			if (result.Deferred != nil) != test.wantCall || workspace.called != test.wantCall {
				t.Fatalf("deferred=%t called=%t, want explicit-trust call=%t", result.Deferred != nil, workspace.called, test.wantCall)
			}
		})
	}
}
