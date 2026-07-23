package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestCompletionTraceUsesStructuredPrivateReason(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	server.settings.Trace = "messages"
	server.trusted = false
	uri := protocol.DocumentURI("file:///private/workspace/secret-agent.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const secretToken = agent({ prompt: wr",
	})

	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodCompletion,
		Params:  []byte(`{"textDocument":{"uri":"file:///private/workspace/secret-agent.ts"},"position":{"line":0,"character":39}}`),
	})
	if result.Deferred != nil {
		t.Fatal("untrusted completion reached deferred query")
	}
	if got := len(server.outbound); got != 2 {
		t.Fatalf("completion trace notifications = %d, want method plus outcome", got)
	}
	<-server.Outbound() // ordinary method trace
	outcome := <-server.Outbound()
	params := outcome.Params.(protocol.LogMessageParams)
	if params.Message != "completion outcome=untrusted" {
		t.Fatalf("completion trace = %q, want structured untrusted reason", params.Message)
	}
	for _, private := range []string{
		"secretToken",
		"secret-agent.ts",
		"/private/workspace",
	} {
		if strings.Contains(params.Message, private) {
			t.Fatalf("completion trace leaked %q: %q", private, params.Message)
		}
	}
}

func TestCompletionTraceClassifiesEveryWorkspaceOutcomePrivately(t *testing.T) {
	t.Parallel()

	tests := []struct {
		reason completionOutcomeReason
		kind   completionOutcomeKind
		items  []readmodel.CompletionItem
	}{
		{reason: completionReasonCanceled, kind: completionOutcomeSoft},
		{reason: completionReasonTimeout, kind: completionOutcomeSoft},
		{reason: completionReasonStaleSource, kind: completionOutcomeSoft},
		{reason: completionReasonStaleDocument, kind: completionOutcomeSoft},
		{reason: completionReasonStaleGeneration, kind: completionOutcomeSoft},
		{reason: completionReasonSourceUnavailable, kind: completionOutcomeSoft},
		{reason: completionReasonWorkerFailure, kind: completionOutcomeWorkerFailure},
		{reason: completionReasonEmpty, kind: completionOutcomeCurrent},
		{
			reason: completionReasonItems,
			kind:   completionOutcomeCurrent,
			items:  []readmodel.CompletionItem{{ID: "prompt:writer"}},
		},
	}
	for _, test := range tests {
		t.Run(string(test.reason), func(t *testing.T) {
			t.Parallel()
			workspace := &classifiedCompletionWorkspace{outcome: completionOutcome{
				Kind: test.kind, Reason: test.reason,
				Result: readmodel.CompletionResult{
					DocumentVersion: 1,
					Items:           test.items,
				},
			}}
			server := newTrustedCompletionServer(Options{})
			server.workspace = workspace
			server.settings.Trace = "messages"
			uri := protocol.DocumentURI("file:///private/workspace/secret-agent.ts")
			server.buffers.Open(protocol.TextDocumentItem{
				URI: uri, LanguageID: "typescript", Version: 1,
				Text: "const secretToken = agent({ prompt: wr",
			})

			result := completionRequest(
				t,
				server,
				context.Background(),
				"2",
				uri,
			)
			result.Deferred()
			if got := len(server.outbound); got != 2 {
				t.Fatalf("trace notifications = %d, want method plus outcome", got)
			}
			<-server.Outbound()
			params := (<-server.Outbound()).Params.(protocol.LogMessageParams)
			if want := "completion outcome=" + string(test.reason); params.Message != want {
				t.Fatalf("completion trace = %q, want %q", params.Message, want)
			}
			for _, private := range []string{
				"secretToken",
				"secret-agent.ts",
				"/private/workspace",
			} {
				if strings.Contains(params.Message, private) {
					t.Fatalf("completion trace leaked %q: %q", private, params.Message)
				}
			}
		})
	}
}

func TestCanceledCompletionStillEmitsStructuredOutcomeTrace(t *testing.T) {
	t.Parallel()

	workspace := &cancelingCompletionWorkspace{started: make(chan struct{})}
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.settings.Trace = "messages"
	uri := protocol.DocumentURI("file:///private/workspace/secret-agent.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const secretToken = agent({ prompt: wr",
	})

	result := completionRequest(t, server, context.Background(), "7", uri)
	done := make(chan struct{})
	go func() {
		result.Deferred()
		close(done)
	}()
	<-workspace.started
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodCancelRequest,
		Params:  json.RawMessage(`{"id":7}`),
	})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("canceled completion did not finish")
	}

	var messages []string
	for len(server.outbound) > 0 {
		params := (<-server.Outbound()).Params.(protocol.LogMessageParams)
		messages = append(messages, params.Message)
	}
	if !containsCompletionTrace(messages, "completion outcome=canceled") {
		t.Fatalf("trace messages = %q, want structured canceled outcome", messages)
	}
}

type cancelingCompletionWorkspace struct {
	workspaceController
	started chan struct{}
}

func (*cancelingCompletionWorkspace) Close() {}

func (w *cancelingCompletionWorkspace) Completion(
	ctx context.Context,
	_ protocol.DocumentURI,
	_ readmodel.CompletionRequest,
) completionOutcome {
	close(w.started)
	<-ctx.Done()
	return completionOutcome{
		Kind: completionOutcomeSoft, Reason: completionReasonCanceled,
	}
}

func containsCompletionTrace(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
