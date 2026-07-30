package server

import (
	"context"
	"encoding/json"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextOpenLatestRunLinkReturnsServerConstructedResolverURL(t *testing.T) {
	t.Parallel()

	server := New(Options{Port: 4607})
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 7, Text: "md`hello`",
	})
	document, _ := server.buffers.Snapshot(uri)
	server.workspace = &promptTextLatestRunWorkspace{
		result: lsprompttext.LatestRunLinkResult{
			Revision: document.Revision, Kind: lsprompttext.LatestRunLinkReady,
			DefinitionID: "prompt:billing/support + %",
		},
	}
	params, err := json.Marshal(protocol.PromptTextOpenLatestRunLinkParams{
		URI: uri, OpenEpoch: document.Revision.OpenEpoch,
		Version: document.Revision.Version, SourceHash: document.Revision.SourceHash,
		Position: protocol.Position{Character: 4},
	})
	if err != nil {
		t.Fatal(err)
	}
	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("191"),
		Method: protocol.MethodPromptTextOpenLatestRunLink, Params: params,
	})
	if response.Deferred == nil {
		t.Fatal("latest-Run owner analysis blocked the dispatcher")
	}
	response = response.Deferred()
	result, ok := response.Result.(protocol.PromptTextOpenLatestRunLinkReadyResult)
	if !ok ||
		result.URL != "http://localhost:4607/library/index/prompt/prompt%3Abilling%2Fsupport%20%2B%20%25/latest-run" {
		t.Fatalf("ready result = %#v", response.Result)
	}
}

func TestPromptTextOpenLatestRunLinkDiscardsChangedDocument(t *testing.T) {
	t.Parallel()

	server := New(Options{Port: 4607})
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 7, Text: "md`hello`",
	})
	document, _ := server.buffers.Snapshot(uri)
	server.workspace = &promptTextLatestRunWorkspace{
		result: lsprompttext.LatestRunLinkResult{
			Revision: document.Revision, Kind: lsprompttext.LatestRunLinkReady,
			DefinitionID: "prompt:writer",
		},
	}
	params, err := json.Marshal(protocol.PromptTextOpenLatestRunLinkParams{
		URI: uri, OpenEpoch: document.Revision.OpenEpoch,
		Version: document.Revision.Version, SourceHash: document.Revision.SourceHash,
		Position: protocol.Position{Character: 4},
	})
	if err != nil {
		t.Fatal(err)
	}
	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("192"),
		Method: protocol.MethodPromptTextOpenLatestRunLink, Params: params,
	})
	if response.Deferred == nil {
		t.Fatal("latest-Run owner analysis blocked the dispatcher")
	}
	if !server.buffers.Change(uri, 8, []protocol.TextDocumentContentChangeEvent{{
		Text: "md`changed`",
	}}) {
		t.Fatal("change current source")
	}

	response = response.Deferred()
	result, ok := response.Result.(protocol.PromptTextOpenLatestRunLinkUnavailableResult)
	if !ok || result.Reason != "revision-mismatch" {
		t.Fatalf("changed result = %#v", response.Result)
	}
}

func TestPromptTextOpenLatestRunLinkMapsFragmentToUnavailable(t *testing.T) {
	result := New(Options{Port: 4607}).latestRunLinkResult(
		lsprompttext.LatestRunLinkResult{
			Kind: lsprompttext.LatestRunLinkUnavailable, Reason: "named-fragment",
		},
	)
	unavailable, ok := result.(protocol.PromptTextOpenLatestRunLinkUnavailableResult)
	if !ok || unavailable.Reason != "named-fragment" ||
		unavailable.Message != "This PromptText is a named fragment. Open its canonical Prompt owner." {
		t.Fatalf("unavailable result = %#v", result)
	}
}

type promptTextLatestRunWorkspace struct {
	workspaceController
	result lsprompttext.LatestRunLinkResult
}

func (*promptTextLatestRunWorkspace) Close() {}

func (workspace *promptTextLatestRunWorkspace) PromptTextLatestRunLink(
	context.Context,
	protocol.DocumentURI,
	string,
	protocol.Position,
) lsprompttext.LatestRunLinkResult {
	return workspace.result
}
