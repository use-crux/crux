package server

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextNavigationHandlerSuppressesLegacyFallbackInsideTemplates(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/source.ts")
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 3,
		Text: "const value = md`hello ${name}`",
	})
	document, _ := server.buffers.Snapshot(uri)
	target := protocol.Location{
		URI: "file:///repo/owner.ts",
		Range: protocol.Range{
			Start: protocol.Position{Line: 2},
			End:   protocol.Position{Line: 3},
		},
	}
	workspace := &navigationPromptTextWorkspace{
		promptText: lsprompttext.NavigationResult{
			Revision: document.Revision, Handled: true, Claimed: true,
			Definition: &target, References: []protocol.Location{target},
		},
		legacyDefinition: target,
	}
	server.workspace = workspace

	definition := server.Handle(context.Background(), protocol.Request{
		ID: []byte("definition"), Method: protocol.MethodDefinition,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/source.ts"},
			"position":{"line":0,"character":18}
		}`),
	})
	if definition.Deferred == nil {
		t.Fatal("PromptText definition was not deferred")
	}
	resolved := definition.Deferred()
	if resolved.Error != nil || resolved.Result != target ||
		workspace.legacyCalls != 0 {
		t.Fatalf("definition = %#v, legacy calls=%d", resolved, workspace.legacyCalls)
	}

	workspace.promptText = lsprompttext.NavigationResult{
		Revision: document.Revision, Handled: true,
		References: []protocol.Location{},
	}
	definition = server.Handle(context.Background(), protocol.Request{
		ID: []byte("barrier"), Method: protocol.MethodDefinition,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/source.ts"},
			"position":{"line":0,"character":25}
		}`),
	})
	resolved = definition.Deferred()
	if resolved.Error != nil || resolved.Result != nil ||
		workspace.legacyCalls != 0 {
		t.Fatalf("barrier definition = %#v, legacy calls=%d", resolved, workspace.legacyCalls)
	}

	workspace.promptText = lsprompttext.NavigationResult{
		Revision: document.Revision, References: []protocol.Location{},
	}
	definition = server.Handle(context.Background(), protocol.Request{
		ID: []byte("outside"), Method: protocol.MethodDefinition,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/source.ts"},
			"position":{"line":0,"character":0}
		}`),
	})
	resolved = definition.Deferred()
	if resolved.Result != target || workspace.legacyCalls != 1 {
		t.Fatalf("outside definition = %#v, legacy calls=%d", resolved, workspace.legacyCalls)
	}
}

func TestPromptTextNavigationCancellationUsesStandardError(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/source.ts")
	workspace := &blockingPromptTextNavigationWorkspace{
		started: make(chan struct{}),
	}
	server := New(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const value = md`hello`",
	})
	response := server.Handle(context.Background(), protocol.Request{
		ID: []byte("27"), Method: protocol.MethodDefinition,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/source.ts"},
			"position":{"line":0,"character":18}
		}`),
	})
	if response.Deferred == nil {
		t.Fatal("PromptText navigation did not defer")
	}
	done := make(chan jsonrpc.HandlerResult, 1)
	go func() {
		done <- response.Deferred()
	}()
	<-workspace.started
	server.cancelPromptTextRequest([]byte(`{"id":27}`))

	cancelled := <-done
	if cancelled.Error == nil ||
		cancelled.Error.Code != protocol.RequestCancelledCode {
		t.Fatalf("cancelled navigation = %#v, want standard cancellation", cancelled)
	}
}

type navigationPromptTextWorkspace struct {
	workspaceController
	promptText       lsprompttext.NavigationResult
	legacyDefinition protocol.Location
	legacyCalls      int
}

func (w *navigationPromptTextWorkspace) PromptTextNavigation(
	context.Context,
	protocol.DocumentURI,
	string,
	protocol.Position,
	bool,
) lsprompttext.NavigationResult {
	return w.promptText
}

func (w *navigationPromptTextWorkspace) DefinitionLocation(
	protocol.DocumentURI,
	protocol.Position,
) (protocol.Location, bool) {
	w.legacyCalls++
	return w.legacyDefinition, true
}

type blockingPromptTextNavigationWorkspace struct {
	workspaceController
	started chan struct{}
}

func (w *blockingPromptTextNavigationWorkspace) PromptTextNavigation(
	ctx context.Context,
	_ protocol.DocumentURI,
	_ string,
	_ protocol.Position,
	_ bool,
) lsprompttext.NavigationResult {
	close(w.started)
	<-ctx.Done()
	return lsprompttext.NavigationResult{
		References: []protocol.Location{},
	}
}
