package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextActionCancellationUsesStandardError(t *testing.T) {
	t.Parallel()

	workspace := &cancellingPromptTextActionWorkspace{
		started: make(chan struct{}),
	}
	server := newPromptTextActionTestServer(workspace)
	params := promptTextActionParams(
		"prompt-text:"+strings.Repeat("0", 64),
		protocol.Range{},
	)
	raw, _ := json.Marshal(params)
	response := server.codeActionRequest(context.Background(), []byte("17"), raw)
	if response.Deferred == nil {
		t.Fatal("PromptText cancellation test did not defer regeneration")
	}
	done := make(chan jsonrpc.HandlerResult, 1)
	go func() {
		done <- response.Deferred()
	}()
	<-workspace.started
	server.cancelPromptTextRequest([]byte(`{"id":17}`))
	cancelled := <-done
	if cancelled.Error == nil ||
		cancelled.Error.Code != protocol.RequestCancelledCode {
		t.Fatalf("cancelled action = %#v, want standard cancellation", cancelled)
	}
}

func TestPromptTextActionDocumentRetirementReturnsEmptyContribution(t *testing.T) {
	t.Parallel()

	workspace := &cancellingPromptTextActionWorkspace{
		started: make(chan struct{}),
	}
	server := newPromptTextActionTestServer(workspace)
	uri := protocol.DocumentURI("file:///repo/source.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const value = md`Hello ${true}`",
	})
	params := promptTextActionParams(
		"prompt-text:"+strings.Repeat("0", 64),
		protocol.Range{},
	)
	raw, _ := json.Marshal(params)
	response := server.codeActionRequest(context.Background(), []byte("18"), raw)
	if response.Deferred == nil {
		t.Fatal("PromptText retirement test did not defer regeneration")
	}
	done := make(chan jsonrpc.HandlerResult, 1)
	go func() {
		done <- response.Deferred()
	}()
	<-workspace.started
	change, _ := json.Marshal(protocol.DidChangeTextDocumentParams{
		TextDocument: protocol.VersionedTextDocumentIdentifier{
			TextDocumentIdentifier: protocol.TextDocumentIdentifier{URI: uri},
			Version:                2,
		},
		ContentChanges: []protocol.TextDocumentContentChangeEvent{{
			Text: "const value = md`Hello ${false}`",
		}},
	})
	server.didChange(change)
	retired := <-done
	actions, ok := retired.Result.([]protocol.CodeAction)
	if retired.Error != nil || !ok || len(actions) != 0 {
		t.Fatalf("retired action = %#v, want empty contribution", retired)
	}
}

func newPromptTextActionTestServer(
	workspace workspaceController,
) *Server {
	server := New(Options{})
	server.workspace = workspace
	server.diagnosticDataSupport = true
	server.codeActionLiteralSupport = true
	return server
}

type cancellingPromptTextActionWorkspace struct {
	actionWorkspace
	started chan struct{}
}

func (w *cancellingPromptTextActionWorkspace) PromptTextActions(
	ctx context.Context,
	_ protocol.DocumentURI,
	_ []promptTextActionLocator,
) lsprompttext.ActionResult {
	close(w.started)
	<-ctx.Done()
	return lsprompttext.ActionResult{Actions: []protocol.CodeAction{}}
}
