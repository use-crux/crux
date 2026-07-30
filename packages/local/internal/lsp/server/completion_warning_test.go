package server

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestCompletionFailureWarningIsProcessRateLimitedAndPrivate(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	workspace := &classifiedCompletionWorkspace{}
	server := newTrustedCompletionServer(Options{Now: func() time.Time { return now }})
	server.workspace = workspace
	uri := protocol.DocumentURI("file:///private/workspace/src/secret-agent.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const secretToken = agent({ prompt: wr",
	})

	for attempt := 0; attempt < 2; attempt++ {
		workspace.outcome = completionOutcome{Kind: completionOutcomeWorkerFailure}
		runClassifiedCompletion(t, server, uri, attempt+1)
	}
	if got := len(server.outbound); got != 0 {
		t.Fatalf("pre-threshold notifications = %d, want none", got)
	}

	workspace.outcome = completionOutcome{
		Kind: completionOutcomeWorkerFailureThreshold,
	}
	runClassifiedCompletion(t, server, uri, 3)
	assertPrivateCompletionWarning(t, <-server.Outbound())

	// Another threshold outcome remains inside the process-wide cooldown.
	runClassifiedCompletion(t, server, uri, 4)
	if got := len(server.outbound); got != 0 {
		t.Fatalf("cooldown notifications = %d, want none", got)
	}

	now = now.Add(completionWarningCooldown)
	runClassifiedCompletion(t, server, uri, 5)
	assertPrivateCompletionWarning(t, <-server.Outbound())
}

func TestCompletionFailureWarningIsSharedAcrossScopes(t *testing.T) {
	t.Parallel()

	generation := uint64(7)
	store := readmodel.NewStore()
	workspace := &workspaceRuntime{store: store}
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace

	var uris []protocol.DocumentURI
	for _, id := range []string{"scope-a", "scope-b"} {
		root := t.TempDir()
		store.ApplySnapshot(id, readmodel.Snapshot{Generation: &generation})
		uri := protocol.DocumentURI(
			"file://" + filepath.ToSlash(filepath.Join(root, "src", "agent.ts")),
		)
		workspace.sessions = append(workspace.sessions, &scopeSession{
			scope: readmodel.Scope{ID: id, Root: root},
			mode:  readmodel.ModeOwn,
			transient: &controlledCompletionSource{
				err: errors.New("private compiler failure"),
			},
			sourceEpoch: 1,
		})
		server.buffers.Open(protocol.TextDocumentItem{
			URI: uri, LanguageID: "typescript", Version: 1,
			Text: "agent({ prompt: wr",
		})
		uris = append(uris, uri)
	}

	id := 0
	for attempt := 0; attempt < 3; attempt++ {
		for _, uri := range uris {
			id++
			runClassifiedCompletion(t, server, uri, id)
		}
	}
	if got := len(server.outbound); got != 1 {
		t.Fatalf("two scope thresholds emitted %d warnings, want one", got)
	}
	assertPrivateCompletionWarning(t, <-server.Outbound())
}

func TestCompletionBufferRejectionDoesNotReachFailureWarningPath(t *testing.T) {
	t.Parallel()

	workspace := &classifiedCompletionWorkspace{
		outcome: completionOutcome{Kind: completionOutcomeWorkerFailureThreshold},
	}
	server := New(Options{})
	server.workspace = workspace
	server.buffers = newDocumentBuffers(documentBufferLimits{
		DocumentBytes: 4,
		ProcessBytes:  4,
	})
	uri := protocol.DocumentURI("file:///workspace/private.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "secret",
	})

	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      json.RawMessage("9"),
		Method:  protocol.MethodCompletion,
		Params: json.RawMessage(
			`{"textDocument":{"uri":"file:///workspace/private.ts"},"position":{"line":0,"character":1}}`,
		),
	})
	if result.Deferred != nil {
		t.Fatal("buffer-limit completion reached the workspace")
	}
	if workspace.calls != 0 || len(server.outbound) != 0 {
		t.Fatalf("buffer rejection calls=%d notifications=%d, want zero", workspace.calls, len(server.outbound))
	}
}

func runClassifiedCompletion(
	t *testing.T,
	server *Server,
	uri protocol.DocumentURI,
	id int,
) {
	t.Helper()
	result := completionRequest(t, server, context.Background(), jsonNumber(id), uri)
	list := result.Deferred().Result.(protocol.CompletionList)
	if !list.IsIncomplete || len(list.Items) != 0 {
		t.Fatalf("failed completion = %+v, want empty incomplete", list)
	}
}

func assertPrivateCompletionWarning(
	t *testing.T,
	message protocol.OutboundMessage,
) {
	t.Helper()
	if message.Method != protocol.MethodShowMessage {
		t.Fatalf("warning method = %q, want %q", message.Method, protocol.MethodShowMessage)
	}
	params, ok := message.Params.(protocol.LogMessageParams)
	if !ok {
		t.Fatalf("warning params = %#v, want LogMessageParams", message.Params)
	}
	if params.Type != protocol.MessageTypeWarning ||
		params.Message != completionFailureWarning {
		t.Fatalf("warning = %#v, want exact generic warning", params)
	}
	for _, private := range []string{
		"private compiler failure",
		"secretToken",
		"secret-agent.ts",
		"/private/workspace",
	} {
		if strings.Contains(params.Message, private) {
			t.Fatalf("warning leaked %q: %q", private, params.Message)
		}
	}
}

type classifiedCompletionWorkspace struct {
	workspaceController
	outcome completionOutcome
	calls   int
}

func (*classifiedCompletionWorkspace) Close() {}

func (w *classifiedCompletionWorkspace) Completion(
	context.Context,
	protocol.DocumentURI,
	readmodel.CompletionRequest,
) completionOutcome {
	w.calls++
	return w.outcome
}
