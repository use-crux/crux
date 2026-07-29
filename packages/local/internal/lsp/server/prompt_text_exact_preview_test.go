package server

import (
	"context"
	"encoding/json"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptPreviewExactLinkReturnsServerConstructedCanonicalURL(t *testing.T) {
	t.Parallel()

	server := New(Options{Port: 4607})
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 7, Text: "md`hello`",
	})
	document, _ := server.buffers.Snapshot(uri)
	server.workspace = &promptTextExactLinkWorkspace{
		result: lsprompttext.ExactPreviewLinkResult{
			Revision: document.Revision, Kind: lsprompttext.ExactPreviewLinkReady,
			DefinitionID: "prompt:billing/support + %",
		},
	}
	params, err := json.Marshal(protocol.PromptTextPreviewExactLinkParams{
		URI: uri, OpenEpoch: document.Revision.OpenEpoch,
		Version: document.Revision.Version, SourceHash: document.Revision.SourceHash,
		Position: protocol.Position{Character: 4},
	})
	if err != nil {
		t.Fatal(err)
	}
	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("91"),
		Method: protocol.MethodPromptTextPreviewExactLink, Params: params,
	})
	if response.Deferred == nil {
		t.Fatal("exact owner analysis blocked the dispatcher")
	}
	response = response.Deferred()
	result, ok := response.Result.(protocol.PromptTextPreviewExactLinkReadyResult)
	if !ok ||
		result.URL != "http://localhost:4607/library/index/prompt/prompt%3Abilling%2Fsupport%20%2B%20%25/preview" {
		t.Fatalf("ready result = %#v", response.Result)
	}
}

func TestPromptPreviewExactLinkDiscardsChangedDocument(t *testing.T) {
	t.Parallel()

	server := New(Options{Port: 4607})
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 7, Text: "md`hello`",
	})
	document, _ := server.buffers.Snapshot(uri)
	server.workspace = &promptTextExactLinkWorkspace{
		result: lsprompttext.ExactPreviewLinkResult{
			Revision: document.Revision, Kind: lsprompttext.ExactPreviewLinkReady,
			DefinitionID: "prompt:writer",
		},
	}
	params, err := json.Marshal(protocol.PromptTextPreviewExactLinkParams{
		URI: uri, OpenEpoch: document.Revision.OpenEpoch,
		Version: document.Revision.Version, SourceHash: document.Revision.SourceHash,
		Position: protocol.Position{Character: 4},
	})
	if err != nil {
		t.Fatal(err)
	}
	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("92"),
		Method: protocol.MethodPromptTextPreviewExactLink, Params: params,
	})
	if response.Deferred == nil {
		t.Fatal("exact owner analysis blocked the dispatcher")
	}
	if !server.buffers.Change(uri, 8, []protocol.TextDocumentContentChangeEvent{{
		Text: "md`changed`",
	}}) {
		t.Fatal("change current source")
	}

	response = response.Deferred()
	result, ok := response.Result.(protocol.PromptTextPreviewExactLinkUnavailableResult)
	if !ok || result.Reason != "revision-mismatch" {
		t.Fatalf("changed result = %#v", response.Result)
	}
}

func TestPromptPreviewExactLinkReturnsFrozenStaticOnlyMessage(t *testing.T) {
	result := New(Options{Port: 4607}).exactLinkResult(
		lsprompttext.ExactPreviewLinkResult{
			Kind:   lsprompttext.ExactPreviewLinkStaticOnly,
			Reason: "named-fragment",
		},
	)
	static, ok := result.(protocol.PromptTextPreviewExactLinkStaticResult)
	if !ok || static.Reason != "named-fragment" ||
		static.Message != "This PromptText is a named fragment. Open its canonical Prompt owner or use static preview." {
		t.Fatalf("static result = %#v", result)
	}
}

type promptTextExactLinkWorkspace struct {
	workspaceController
	result lsprompttext.ExactPreviewLinkResult
}

func (*promptTextExactLinkWorkspace) Close() {}

func (workspace *promptTextExactLinkWorkspace) PromptTextExactPreviewLink(
	context.Context,
	protocol.DocumentURI,
	string,
	protocol.Position,
) lsprompttext.ExactPreviewLinkResult {
	return workspace.result
}
