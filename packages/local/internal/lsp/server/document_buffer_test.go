package server

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestDocumentBufferOpenSnapshotsSupportedText(t *testing.T) {
	t.Parallel()

	buffers := newDocumentBuffers(documentBufferLimits{
		DocumentBytes: 2 << 20,
		ProcessBytes:  32 << 20,
	})
	item := protocol.TextDocumentItem{
		URI:        "file:///workspace/src/agent.ts",
		LanguageID: "typescript",
		Version:    7,
		Text:       "export const helper = '😀'\n",
	}
	buffers.Open(item)

	got, ok := buffers.Snapshot(item.URI)
	if !ok {
		t.Fatal("supported open document was not retained")
	}
	if got.URI != item.URI || got.LanguageID != item.LanguageID || got.Version != 7 || got.Text != item.Text {
		t.Fatalf("snapshot = %#v, want detached open document", got)
	}
}

func TestServerDocumentEventsOwnAndClearCompletionBuffer(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodDidOpen,
		Params: []byte(`{
			"textDocument":{
				"uri":"file:///workspace/src/agent.ts",
				"languageId":"typescript",
				"version":1,
				"text":"agent({ prompt: wr })"
			}
		}`),
	})
	if got, ok := server.buffers.Snapshot(uri); !ok || got.Text != "agent({ prompt: wr })" {
		t.Fatalf("didOpen buffer = %#v, %v", got, ok)
	}

	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodShutdown,
		ID:      []byte("1"),
	})
	if _, ok := server.buffers.Snapshot(uri); ok {
		t.Fatal("shutdown retained completion buffer")
	}
}

func TestDocumentBufferRetainsOnlyCompletionLanguages(t *testing.T) {
	t.Parallel()

	buffers := newDocumentBuffers(documentBufferLimits{DocumentBytes: 100, ProcessBytes: 200})
	for index, languageID := range []string{
		"typescript", "typescriptreact", "javascript", "javascriptreact",
	} {
		uri := protocol.DocumentURI("file:///workspace/supported-" + languageID)
		buffers.Open(protocol.TextDocumentItem{
			URI: uri, LanguageID: languageID, Version: index + 1, Text: languageID,
		})
		if _, ok := buffers.Snapshot(uri); !ok {
			t.Fatalf("language %q was not retained", languageID)
		}
	}

	unsupported := protocol.DocumentURI("file:///workspace/notes.md")
	buffers.Open(protocol.TextDocumentItem{
		URI: unsupported, LanguageID: "markdown", Version: 1, Text: "secret",
	})
	if _, ok := buffers.Snapshot(unsupported); ok {
		t.Fatal("unsupported document was retained")
	}
}

func TestDocumentBufferAppliesOrderedUTF16Changes(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	buffers := newDocumentBuffers(documentBufferLimits{DocumentBytes: 1 << 20, ProcessBytes: 2 << 20})
	buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1,
		Text: "const face = '😀';\nagent({ prompt: wr })\n",
	})
	changes := []protocol.TextDocumentContentChangeEvent{
		{
			Range: &protocol.Range{
				Start: protocol.Position{Line: 0, Character: 14},
				End:   protocol.Position{Line: 0, Character: 16},
			},
			Text: "🙂🙂",
		},
		{
			Range: &protocol.Range{
				Start: protocol.Position{Line: 1, Character: 16},
				End:   protocol.Position{Line: 1, Character: 16},
			},
			Text: "it",
		},
		{
			Range: &protocol.Range{
				Start: protocol.Position{Line: 1, Character: 16},
				End:   protocol.Position{Line: 1, Character: 20},
			},
			Text: "writer",
		},
	}
	if !buffers.Change(uri, 2, changes) {
		t.Fatal("valid ordered change was rejected")
	}

	got, ok := buffers.Snapshot(uri)
	if !ok || got.Version != 2 {
		t.Fatalf("snapshot = %#v, %v; want version 2", got, ok)
	}
	want := "const face = '🙂🙂';\nagent({ prompt: writer })\n"
	if got.Text != want {
		t.Fatalf("changed text = %q, want %q", got.Text, want)
	}
}

func TestDocumentBufferInvalidatesUntilNewerFullReplacement(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///workspace/src/agent.ts")
	buffers := newDocumentBuffers(documentBufferLimits{DocumentBytes: 1 << 20, ProcessBytes: 2 << 20})
	buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 3, Text: "agent({ prompt: old })",
	})
	insertion := protocol.Range{
		Start: protocol.Position{Line: 0, Character: 0},
		End:   protocol.Position{Line: 0, Character: 0},
	}
	if buffers.Change(uri, 2, []protocol.TextDocumentContentChangeEvent{{Range: &insertion, Text: "x"}}) {
		t.Fatal("regressive change was accepted")
	}
	if _, ok := buffers.Snapshot(uri); ok {
		t.Fatal("regressive change left stale text available")
	}
	if buffers.Change(uri, 4, []protocol.TextDocumentContentChangeEvent{{Range: &insertion, Text: "x"}}) {
		t.Fatal("incremental change recovered an unavailable buffer")
	}
	if !buffers.Change(uri, 5, []protocol.TextDocumentContentChangeEvent{{Text: "agent({ prompt: fresh })"}}) {
		t.Fatal("newer full replacement did not recover the buffer")
	}
	if got, ok := buffers.Snapshot(uri); !ok || got.Version != 5 || got.Text != "agent({ prompt: fresh })" {
		t.Fatalf("recovered snapshot = %#v, %v", got, ok)
	}

	invalid := protocol.Range{
		Start: protocol.Position{Line: 9, Character: 0},
		End:   protocol.Position{Line: 9, Character: 1},
	}
	if buffers.Change(uri, 6, []protocol.TextDocumentContentChangeEvent{{Range: &invalid, Text: "x"}}) {
		t.Fatal("invalid range was accepted")
	}
	if _, ok := buffers.Snapshot(uri); ok {
		t.Fatal("invalid range left stale text available")
	}
	if !buffers.Change(uri, 7, []protocol.TextDocumentContentChangeEvent{{Text: "recovered"}}) {
		t.Fatal("full replacement did not recover after invalid range")
	}
}

func TestDocumentBufferEnforcesByteLimitsAndReleasesOnClose(t *testing.T) {
	t.Parallel()

	buffers := newDocumentBuffers(documentBufferLimits{DocumentBytes: 10, ProcessBytes: 15})
	first := protocol.DocumentURI("file:///workspace/first.ts")
	second := protocol.DocumentURI("file:///workspace/second.ts")
	oversized := protocol.DocumentURI("file:///workspace/oversized.ts")
	buffers.Open(protocol.TextDocumentItem{
		URI: first, LanguageID: "typescript", Version: 1, Text: "0123456789",
	})
	buffers.Open(protocol.TextDocumentItem{
		URI: second, LanguageID: "typescript", Version: 1, Text: "abcdef",
	})
	if _, ok := buffers.Snapshot(first); !ok {
		t.Fatal("document at byte limit was rejected")
	}
	if _, ok := buffers.Snapshot(second); ok {
		t.Fatal("document exceeding process limit was retained")
	}

	buffers.Close(first)
	buffers.Open(protocol.TextDocumentItem{
		URI: second, LanguageID: "typescript", Version: 2, Text: "abcdef",
	})
	if _, ok := buffers.Snapshot(second); !ok {
		t.Fatal("close did not release process byte budget")
	}
	buffers.Open(protocol.TextDocumentItem{
		URI: oversized, LanguageID: "typescript", Version: 1, Text: "01234567890",
	})
	if _, ok := buffers.Snapshot(oversized); ok {
		t.Fatal("document exceeding per-document limit was retained")
	}

	buffers.Clear()
	if _, ok := buffers.Snapshot(second); ok {
		t.Fatal("clear retained an open document")
	}
}

func TestServerTracesBufferLimitOnceWithoutSourceText(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	server.settings.Trace = "messages"
	server.buffers = newDocumentBuffers(documentBufferLimits{DocumentBytes: 10, ProcessBytes: 20})
	uri := protocol.DocumentURI("file:///workspace/src/private.ts")
	secret := "do-not-log!"

	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodDidOpen,
		Params: []byte(`{
			"textDocument":{
				"uri":"file:///workspace/src/private.ts",
				"languageId":"typescript",
				"version":1,
				"text":"do-not-log!"
			}
		}`),
	})
	if got := len(server.outbound); got != 2 {
		t.Fatalf("didOpen notifications = %d, want method trace plus one limit trace", got)
	}
	<-server.Outbound() // method trace
	limitNotification := <-server.Outbound()
	params := limitNotification.Params.(protocol.LogMessageParams)
	if strings.Contains(params.Message, string(uri)) ||
		strings.Contains(params.Message, "/workspace") ||
		strings.Contains(params.Message, "private.ts") ||
		!strings.Contains(params.Message, "uriHash=") ||
		!strings.Contains(params.Message, "documentBytes=11") ||
		strings.Contains(params.Message, secret) {
		t.Fatalf("limit trace = %q, want URI hash and size metadata without private text", params.Message)
	}

	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodDidChange,
		Params: []byte(`{
			"textDocument":{"uri":"file:///workspace/src/private.ts","version":2},
			"contentChanges":[{
				"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"text":"x"
			}]
		}`),
	})
	if got := len(server.outbound); got != 1 {
		t.Fatalf("incremental change notifications = %d, want only the ordinary method trace", got)
	}
}

func TestDocumentBufferReplacementLimitNoticeUsesReplacementTotal(t *testing.T) {
	t.Parallel()

	buffers := newDocumentBuffers(documentBufferLimits{
		DocumentBytes: 10,
		ProcessBytes:  10,
	})
	first := protocol.DocumentURI("file:///workspace/first.ts")
	second := protocol.DocumentURI("file:///workspace/second.ts")
	buffers.Open(protocol.TextDocumentItem{
		URI: first, LanguageID: "typescript", Version: 1, Text: "1234",
	})
	buffers.Open(protocol.TextDocumentItem{
		URI: second, LanguageID: "typescript", Version: 1, Text: "5678",
	})

	ok, notice := buffers.ApplyChanges(
		first,
		2,
		[]protocol.TextDocumentContentChangeEvent{{Text: "1234567"}},
	)
	if ok || notice == nil || notice.Reason != "process_limit" ||
		notice.ProcessBytes != 11 {
		t.Fatalf("replacement result ok=%t notice=%+v, want exact 11-byte process total", ok, notice)
	}
}
