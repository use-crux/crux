package server

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextRefactorActionIsDiagnosticFreeAndContextGated(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/source.ts")
	want := protocol.CodeAction{
		Title: "Convert multiline string to `md` PromptText",
		Kind:  protocol.CodeActionRefactorRewrite,
	}
	workspace := &refactorActionWorkspace{
		result: lsprompttext.RefactorResult{
			Actions: []protocol.CodeAction{want},
		},
	}
	server := New(Options{})
	server.codeActionRefactorSupport = true
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "agent({ prompt: \"first\\nsecond\" })",
	})
	request := protocol.Request{
		ID: []byte("refactor"), Method: protocol.MethodCodeAction,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/source.ts"},
			"range":{"start":{"line":0,"character":18},"end":{"line":0,"character":18}},
			"context":{"diagnostics":[],"only":["refactor.rewrite"]}
		}`),
	}
	response := server.Handle(context.Background(), request)
	if response.Deferred == nil {
		t.Fatal("refactor request was not deferred")
	}
	result := response.Deferred()
	actions, ok := result.Result.([]protocol.CodeAction)
	if result.Error != nil || !ok || len(actions) != 1 ||
		!reflect.DeepEqual(actions[0], want) {
		t.Fatalf("actions = %#v, error=%#v", result.Result, result.Error)
	}
	if workspace.calls != 1 {
		t.Fatalf("refactor calls = %d, want 1", workspace.calls)
	}

	request.Params = []byte(`{
		"textDocument":{"uri":"file:///repo/source.ts"},
		"range":{"start":{"line":0,"character":18},"end":{"line":0,"character":18}},
		"context":{"diagnostics":[],"only":["quickfix"]}
	}`)
	response = server.Handle(context.Background(), request)
	if response.Deferred != nil {
		t.Fatal("quickfix-only request unexpectedly ran refactor analysis")
	}
	if workspace.calls != 1 {
		t.Fatalf("quickfix-only refactor calls = %d, want 1", workspace.calls)
	}
}

func TestRefactorRewriteCapabilityRequiresLiteralSupport(t *testing.T) {
	t.Parallel()

	capabilities := &protocol.ClientCapabilities{
		TextDocument: &protocol.TextDocumentClientCapabilities{
			CodeAction: &protocol.CodeActionClientCapabilities{
				CodeActionLiteralSupport: &protocol.CodeActionLiteralSupport{
					CodeActionKind: protocol.CodeActionKindLiteralSupport{
						ValueSet: []protocol.CodeActionKind{
							protocol.CodeActionQuickFix,
							protocol.CodeActionRefactor,
						},
					},
				},
			},
		},
	}
	quickFix, refactor := codeActionLiteralSupport(capabilities)
	if !quickFix || !refactor {
		t.Fatalf("literal support = quickfix:%v refactor:%v", quickFix, refactor)
	}

	server := New(Options{})
	raw, err := json.Marshal(protocol.InitializeParams{
		Capabilities: capabilities,
	})
	if err != nil {
		t.Fatal(err)
	}
	result := server.initialize(raw)
	initialize, ok := result.Result.(protocol.InitializeResult)
	if !ok {
		t.Fatalf("initialize result = %#v", result)
	}
	kinds := initialize.Capabilities.CodeActionProvider.CodeActionKinds
	if len(kinds) != 2 || kinds[0] != protocol.CodeActionQuickFix ||
		kinds[1] != protocol.CodeActionRefactorRewrite {
		t.Fatalf("advertised code action kinds = %#v", kinds)
	}
}

type refactorActionWorkspace struct {
	workspaceController
	result lsprompttext.RefactorResult
	calls  int
}

func (*refactorActionWorkspace) LeadingWhitespace(
	protocol.DocumentURI,
	uint32,
) (string, bool) {
	return "", false
}

func (w *refactorActionWorkspace) PromptTextStringRefactor(
	context.Context,
	protocol.DocumentURI,
	protocol.Range,
) lsprompttext.RefactorResult {
	w.calls++
	return w.result
}
