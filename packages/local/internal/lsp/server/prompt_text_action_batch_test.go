package server

import (
	"context"
	"encoding/json"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextActionBatchDropsEarlierActionAfterIdentityChange(
	t *testing.T,
) {
	t.Parallel()

	server, workspace, session, _, uri := newPromptTextSourceHarness(
		t,
		lifecyclePromptTextSource{},
	)
	server.diagnosticDataSupport = true
	server.codeActionLiteralSupport = true
	_, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	session.promptTextDiagnostics[uri] = &promptTextDiagnosticRequest{
		generation: 1,
		cancel:     cancel,
	}
	server.workspace = &invalidatingPromptTextActionWorkspace{
		workspaceRuntime: workspace,
		session:          session,
	}

	params := promptTextActionParams(
		"prompt-text:0000000000000000000000000000000000000000000000000000000000000001",
		lifecycleExpressionRange(),
	)
	secondData, _ := json.Marshal(map[string]string{
		"kind": "prompt-text",
		"id":   "prompt-text:0000000000000000000000000000000000000000000000000000000000000002",
	})
	params.Context.Diagnostics = append(
		params.Context.Diagnostics,
		protocol.Diagnostic{
			Range: lifecycleExpressionRange(),
			Data:  secondData,
		},
	)
	raw, _ := json.Marshal(params)
	response := server.codeActionRequest(
		context.Background(),
		[]byte("32"),
		raw,
	)
	if response.Deferred == nil {
		t.Fatal("multi-locator PromptText action did not defer regeneration")
	}
	response = response.Deferred()
	actions, ok := response.Result.([]protocol.CodeAction)
	if response.Error != nil || !ok || len(actions) != 0 {
		t.Fatalf("stale multi-locator contribution = %#v, want none", response)
	}
}

type invalidatingPromptTextActionWorkspace struct {
	*workspaceRuntime
	session *scopeSession
}

func (w *invalidatingPromptTextActionWorkspace) PromptTextActions(
	ctx context.Context,
	uri protocol.DocumentURI,
	locators []promptTextActionLocator,
) lsprompttext.ActionResult {
	return w.workspaceRuntime.promptTextActions(
		ctx,
		uri,
		locators,
		func(index int) {
			if index == 0 {
				w.mu.Lock()
				w.session.sourceEpoch++
				w.mu.Unlock()
			}
		},
	)
}
