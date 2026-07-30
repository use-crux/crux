package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextCodeActionUsesStrictLocatorAndRegeneratedAction(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/source.ts")
	id := "prompt-text:" + strings.Repeat("0", 64)
	expressionRange := protocol.Range{
		Start: protocol.Position{Line: 2, Character: 12},
		End:   protocol.Position{Line: 2, Character: 16},
	}
	regenerated := protocol.CodeAction{
		Title: "Serialize with `md.json()`", Kind: protocol.CodeActionQuickFix,
	}
	workspace := &promptTextActionWorkspaceStub{
		actionWorkspace: actionWorkspace{},
		result: lsprompttext.ActionResult{
			Actions: []protocol.CodeAction{regenerated},
		},
	}
	server := New(Options{})
	server.workspace = workspace
	server.diagnosticDataSupport = true
	server.codeActionLiteralSupport = true
	data, _ := json.Marshal(map[string]string{
		"kind": "prompt-text", "id": id,
	})
	params, _ := json.Marshal(protocol.CodeActionParams{
		TextDocument: protocol.TextDocumentIdentifier{URI: uri},
		Range:        expressionRange,
		Context: protocol.CodeActionContext{Diagnostics: []protocol.Diagnostic{{
			Range: expressionRange, Code: "client-forged", Message: "client-forged",
			Data: data,
		}}},
	})
	response := server.codeActionRequest(context.Background(), []byte("1"), params)
	if response.Deferred == nil {
		t.Fatal("PromptText action regeneration blocked the serial dispatcher")
	}
	response = response.Deferred()
	actions, ok := response.Result.([]protocol.CodeAction)
	if !ok || len(actions) != 1 || actions[0].Title != regenerated.Title {
		t.Fatalf("actions = %#v, want regenerated contribution", response)
	}
	if workspace.locator.ID != id ||
		workspace.locator.DiagnosticRange != expressionRange ||
		workspace.locator.RequestRange != expressionRange {
		t.Fatalf("locator = %#v, want strict id and exact ranges", workspace.locator)
	}
}

func TestPromptTextActionDoesNotDependOnLintLineLookup(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/source.ts")
	id := "prompt-text:" + strings.Repeat("0", 64)
	expressionRange := protocol.Range{
		Start: protocol.Position{Line: 2, Character: 12},
		End:   protocol.Position{Line: 2, Character: 16},
	}
	workspace := &promptTextActionWorkspaceWithoutLintLine{
		promptTextActionWorkspaceStub: promptTextActionWorkspaceStub{
			result: lsprompttext.ActionResult{
				Actions: []protocol.CodeAction{{
					Title: "Serialize with `md.json()`",
					Kind:  protocol.CodeActionQuickFix,
				}},
			},
		},
	}
	server := New(Options{})
	server.workspace = workspace
	server.diagnosticDataSupport = true
	server.codeActionLiteralSupport = true
	data, _ := json.Marshal(map[string]string{
		"kind": "prompt-text", "id": id,
	})
	params, _ := json.Marshal(protocol.CodeActionParams{
		TextDocument: protocol.TextDocumentIdentifier{URI: uri},
		Range:        expressionRange,
		Context: protocol.CodeActionContext{Diagnostics: []protocol.Diagnostic{{
			Range: expressionRange,
			Data:  data,
		}}},
	})

	response := server.codeActionRequest(context.Background(), []byte("2"), params)
	if response.Deferred == nil {
		t.Fatal("PromptText action incorrectly required a lint line lookup")
	}
}

func TestPromptTextCodeActionRejectsForeignDiagnosticData(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	server.workspace = &promptTextActionWorkspaceStub{
		actionWorkspace: actionWorkspace{},
	}
	server.diagnosticDataSupport = true
	server.codeActionLiteralSupport = true
	params, _ := json.Marshal(protocol.CodeActionParams{
		TextDocument: protocol.TextDocumentIdentifier{URI: "file:///repo/source.ts"},
		Context: protocol.CodeActionContext{Diagnostics: []protocol.Diagnostic{{
			Source: "crux", Message: "invalid",
			Data: []byte(`{"kind":"prompt-text","id":"prompt-text:` +
				strings.Repeat("0", 64) +
				`","ruleId":"forged","suppression":{"supported":true,` +
				`"scope":"next-line","directive":"// forged"}}`),
		}}},
	})
	response := server.codeActionRequest(context.Background(), []byte("2"), params)
	if response.Deferred != nil {
		t.Fatal("foreign PromptText diagnostic data reached regeneration")
	}
	actions, ok := response.Result.([]protocol.CodeAction)
	if !ok || len(actions) != 0 {
		t.Fatalf("foreign PromptText diagnostic emitted legacy action: %#v", response)
	}
}

func TestPromptTextActionRequiresStandardCapabilitiesAndQuickFixKind(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name        string
		dataSupport bool
		literal     bool
		only        []protocol.CodeActionKind
	}{
		{name: "missing diagnostic data support", literal: true},
		{name: "missing literal support", dataSupport: true},
		{
			name: "unsupported requested kind", dataSupport: true, literal: true,
			only: []protocol.CodeActionKind{"source.fixAll"},
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			workspace := &promptTextActionWorkspaceStub{
				actionWorkspace: actionWorkspace{},
			}
			server := New(Options{})
			server.workspace = workspace
			server.diagnosticDataSupport = test.dataSupport
			server.codeActionLiteralSupport = test.literal
			params := promptTextActionParams(
				"prompt-text:"+strings.Repeat("0", 64),
				protocol.Range{},
			)
			params.Context.Only = test.only
			raw, _ := json.Marshal(params)
			response := server.codeActionRequest(
				context.Background(),
				[]byte("3"),
				raw,
			)
			if response.Deferred != nil {
				t.Fatalf("unsupported request reached regeneration: %#v", response)
			}
		})
	}
}

func TestPromptTextDiagnosticAndActionCapabilitiesUseStandardGates(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	params, _ := json.Marshal(protocol.InitializeParams{
		Capabilities: &protocol.ClientCapabilities{
			TextDocument: &protocol.TextDocumentClientCapabilities{
				PublishDiagnostics: &protocol.PublishDiagnosticsClientCapabilities{
					VersionSupport: true,
					DataSupport:    true,
				},
				CodeAction: &protocol.CodeActionClientCapabilities{
					CodeActionLiteralSupport: &protocol.CodeActionLiteralSupport{
						CodeActionKind: protocol.CodeActionKindLiteralSupport{
							ValueSet: []protocol.CodeActionKind{
								protocol.CodeActionQuickFix,
							},
						},
					},
				},
			},
		},
	})
	response := server.initialize(params)
	if response.Error != nil ||
		!server.diagnosticVersionSupport ||
		!server.diagnosticDataSupport ||
		!server.codeActionLiteralSupport {
		t.Fatalf("standard capability gates = %#v", response)
	}
	result := response.Result.(protocol.InitializeResult)
	if result.Capabilities.CodeActionProvider.ResolveProvider {
		t.Fatal("PromptText added codeAction/resolve")
	}
}

func promptTextActionParams(
	id string,
	expressionRange protocol.Range,
) protocol.CodeActionParams {
	data, _ := json.Marshal(map[string]string{
		"kind": "prompt-text", "id": id,
	})
	return protocol.CodeActionParams{
		TextDocument: protocol.TextDocumentIdentifier{
			URI: "file:///repo/source.ts",
		},
		Range: expressionRange,
		Context: protocol.CodeActionContext{Diagnostics: []protocol.Diagnostic{{
			Range: expressionRange,
			Data:  data,
		}}},
	}
}

type promptTextActionWorkspaceStub struct {
	actionWorkspace
	locator promptTextActionLocator
	result  lsprompttext.ActionResult
}

func (w *promptTextActionWorkspaceStub) PromptTextActions(
	_ context.Context,
	_ protocol.DocumentURI,
	locators []promptTextActionLocator,
) lsprompttext.ActionResult {
	if len(locators) > 0 {
		w.locator = locators[0]
	}
	return w.result
}

type promptTextActionWorkspaceWithoutLintLine struct {
	promptTextActionWorkspaceStub
}

func (*promptTextActionWorkspaceWithoutLintLine) LeadingWhitespace(
	protocol.DocumentURI,
	uint32,
) (string, bool) {
	return "", false
}
