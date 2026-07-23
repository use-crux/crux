package server

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestLatestCompletionCancelsPriorRequestForSameDocument(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := newSequencedCompletionWorkspace()
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "agent({ prompt: wr",
	})

	parent, cancel := context.WithCancel(context.Background())
	defer cancel()
	first := completionRequest(t, server, parent, "1", uri)
	firstDone := make(chan protocol.CompletionList, 1)
	go func() { firstDone <- first.Deferred().Result.(protocol.CompletionList) }()
	workspace.waitForCall(t, 1)

	second := completionRequest(t, server, parent, "2", uri)
	secondDone := make(chan protocol.CompletionList, 1)
	go func() { secondDone <- second.Deferred().Result.(protocol.CompletionList) }()
	workspace.waitForCall(t, 2)

	select {
	case list := <-firstDone:
		if !list.IsIncomplete || len(list.Items) != 0 {
			t.Fatalf("superseded completion = %+v, want empty incomplete", list)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("new completion did not cancel prior work for the same document")
	}

	workspace.release(2)
	<-secondDone
}

func TestDidCloseCancelsPendingCompletionForDocument(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := newSequencedCompletionWorkspace()
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "agent({ prompt: wr",
	})

	parent, cancel := context.WithCancel(context.Background())
	defer cancel()
	pending := completionRequest(t, server, parent, "3", uri)
	done := make(chan protocol.CompletionList, 1)
	go func() { done <- pending.Deferred().Result.(protocol.CompletionList) }()
	workspace.waitForCall(t, 1)

	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodDidClose,
		Params:  json.RawMessage(`{"textDocument":{"uri":"file:///workspace/src/agent.ts"}}`),
	})

	select {
	case list := <-done:
		if !list.IsIncomplete || len(list.Items) != 0 {
			t.Fatalf("closed-document completion = %+v, want empty incomplete", list)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("didClose did not cancel pending completion work")
	}
}

func TestDidChangeCancelsPendingCompletionForDocument(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	workspace := newSequencedCompletionWorkspace()
	server := newTrustedCompletionServer(Options{})
	server.workspace = workspace
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "agent({ prompt: wr",
	})

	parent, cancel := context.WithCancel(context.Background())
	defer cancel()
	pending := completionRequest(t, server, parent, "4", uri)
	done := make(chan protocol.CompletionList, 1)
	go func() { done <- pending.Deferred().Result.(protocol.CompletionList) }()
	workspace.waitForCall(t, 1)

	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodDidChange,
		Params: json.RawMessage(`{
			"textDocument":{"uri":"file:///workspace/src/agent.ts","version":2},
			"contentChanges":[{"text":"agent({ prompt: writer })"}]
		}`),
	})

	select {
	case list := <-done:
		if !list.IsIncomplete || len(list.Items) != 0 {
			t.Fatalf("changed-document completion = %+v, want empty incomplete", list)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("didChange did not cancel pending completion work")
	}
}

func TestDefaultDocumentBufferLimitsUseInclusiveByteBoundaries(t *testing.T) {
	t.Parallel()

	buffers := newDocumentBuffers(documentBufferLimits{
		DocumentBytes: defaultDocumentBufferBytes,
		ProcessBytes:  defaultProcessBufferBytes,
	})
	document := strings.Repeat("a", defaultDocumentBufferBytes)
	var retained []protocol.DocumentURI
	for index := 0; index < defaultProcessBufferBytes/defaultDocumentBufferBytes; index++ {
		uri := protocol.DocumentURI(
			"file:///workspace/document-" + string(rune('a'+index)) + ".ts",
		)
		retained = append(retained, uri)
		buffers.Open(protocol.TextDocumentItem{
			URI: uri, LanguageID: "typescript", Version: 1, Text: document,
		})
		if _, ok := buffers.Snapshot(uri); !ok {
			t.Fatalf("document %d at the 2 MiB limit was unavailable", index)
		}
	}

	third := protocol.DocumentURI("file:///workspace/overflow.ts")
	notice := buffers.Open(protocol.TextDocumentItem{
		URI: third, LanguageID: "typescript", Version: 1, Text: "c",
	})
	if notice == nil || notice.Reason != "process_limit" {
		t.Fatalf("process overflow notice = %+v, want process_limit", notice)
	}
	if _, ok := buffers.Snapshot(third); ok {
		t.Fatal("document exceeding the process limit was retained")
	}

	buffers.Close(retained[0])
	if notice := buffers.Open(protocol.TextDocumentItem{
		URI: third, LanguageID: "typescript", Version: 2, Text: "c",
	}); notice != nil {
		t.Fatalf("close did not release the process budget: %+v", notice)
	}

	oversized := protocol.DocumentURI("file:///workspace/oversized.ts")
	notice = buffers.Open(protocol.TextDocumentItem{
		URI: oversized, LanguageID: "typescript", Version: 1,
		Text: strings.Repeat("d", defaultDocumentBufferBytes+1),
	})
	if notice == nil || notice.Reason != "document_limit" {
		t.Fatalf("document overflow notice = %+v, want document_limit", notice)
	}
}

func completionRequest(
	t *testing.T,
	server *Server,
	ctx context.Context,
	id string,
	uri protocol.DocumentURI,
) jsonrpc.HandlerResult {
	t.Helper()
	result := server.Handle(ctx, protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      json.RawMessage(id),
		Method:  protocol.MethodCompletion,
		Params: json.RawMessage(
			`{"textDocument":{"uri":"` + string(uri) + `"},"position":{"line":0,"character":18}}`,
		),
	})
	if result.Deferred == nil {
		t.Fatal("completion was not deferred")
	}
	return result
}

type sequencedCompletionWorkspace struct {
	workspaceController

	mu       sync.Mutex
	calls    int
	started  chan int
	releases map[int]chan struct{}
}

func newSequencedCompletionWorkspace() *sequencedCompletionWorkspace {
	return &sequencedCompletionWorkspace{
		started: make(chan int, 2), releases: make(map[int]chan struct{}),
	}
}

func (*sequencedCompletionWorkspace) Close() {}

func (*sequencedCompletionWorkspace) DidClose(protocol.DocumentURI) {}

func (*sequencedCompletionWorkspace) DidChange(
	protocol.DocumentURI,
	int,
	[]protocol.TextDocumentContentChangeEvent,
) {
}

func (w *sequencedCompletionWorkspace) Completion(
	ctx context.Context,
	_ protocol.DocumentURI,
	request readmodel.CompletionRequest,
) completionOutcome {
	w.mu.Lock()
	w.calls++
	call := w.calls
	release := make(chan struct{})
	w.releases[call] = release
	w.mu.Unlock()
	w.started <- call

	select {
	case <-ctx.Done():
		return completionOutcome{Kind: completionOutcomeSoft}
	case <-release:
		return completionOutcome{
			Kind: completionOutcomeCurrent,
			Result: readmodel.CompletionResult{
				DocumentVersion: request.DocumentVersion,
			},
		}
	}
}

func (w *sequencedCompletionWorkspace) waitForCall(t *testing.T, want int) {
	t.Helper()
	select {
	case got := <-w.started:
		if got != want {
			t.Fatalf("completion call = %d, want %d", got, want)
		}
	case <-time.After(time.Second):
		t.Fatalf("completion call %d did not start", want)
	}
}

func (w *sequencedCompletionWorkspace) release(call int) {
	w.mu.Lock()
	release := w.releases[call]
	w.mu.Unlock()
	close(release)
}
