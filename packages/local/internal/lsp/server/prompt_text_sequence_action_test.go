package server

import (
	"context"
	"encoding/json"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextSequenceCodeActionsPreserveCanonicalOrder(t *testing.T) {
	t.Parallel()

	expressionRange := protocol.Range{
		Start: protocol.Position{Line: 1, Character: 26},
		End:   protocol.Position{Line: 1, Character: 42},
	}
	workspace := &promptTextActionWorkspaceStub{
		result: lsprompttext.ActionResult{
			Actions: []protocol.CodeAction{
				{
					Title: `.join(", ")`,
					Kind:  protocol.CodeActionQuickFix,
				},
				{
					Title: "Put sequence on its own line — changes layout",
					Kind:  protocol.CodeActionQuickFix,
				},
			},
		},
	}
	server := New(Options{})
	server.workspace = workspace
	server.diagnosticDataSupport = true
	server.codeActionLiteralSupport = true
	params := promptTextActionParams(
		"prompt-text:0000000000000000000000000000000000000000000000000000000000000002",
		expressionRange,
	)
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}

	response := server.codeActionRequest(context.Background(), []byte("13"), raw)
	if response.Deferred == nil {
		t.Fatal("PromptText sequence action regeneration blocked the dispatcher")
	}
	response = response.Deferred()
	actions, ok := response.Result.([]protocol.CodeAction)
	if !ok || len(actions) != 2 ||
		actions[0].Title != `.join(", ")` ||
		actions[1].Title != "Put sequence on its own line — changes layout" {
		t.Fatalf("sequence actions = %#v, want canonical ordered pair", response)
	}
}
