package server

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextDecorationsEchoExactRevisionAndHeading(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 11, Text: "md`# Hello`",
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	server.workspace = &promptTextHandlerWorkspace{result: lsprompttext.Result{
		Revision: document.Revision,
		Decorations: []lsprompttext.Decoration{{
			Role: lsprompttext.DecorationRoleHeading,
			Range: protocol.Range{
				Start: protocol.Position{Character: 5},
				End:   protocol.Position{Character: 10},
			},
		}},
	}}
	params, err := json.Marshal(protocol.PromptTextDecorationParams{
		ProtocolVersion: protocol.PromptTextProtocolVersion,
		URI:             uri,
		OpenEpoch:       document.Revision.OpenEpoch,
		Version:         document.Revision.Version,
		SourceHash:      document.Revision.SourceHash,
	})
	if err != nil {
		t.Fatal(err)
	}

	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("31"),
		Method: protocol.MethodPromptTextDecorations, Params: params,
	})
	if response.Deferred == nil {
		t.Fatal("PromptText analysis blocked the serial dispatcher")
	}
	response = response.Deferred()
	result, ok := response.Result.(protocol.PromptTextDecorationResult)
	if !ok {
		t.Fatalf("result = %T, want PromptTextDecorationResult", response.Result)
	}
	if result.ProtocolVersion != protocol.PromptTextProtocolVersion ||
		result.URI != uri ||
		result.OpenEpoch != document.Revision.OpenEpoch ||
		result.Version != document.Revision.Version ||
		result.SourceHash != document.Revision.SourceHash ||
		len(result.Decorations) != 1 ||
		result.Decorations[0].Role != protocol.PromptTextDecorationRoleHeading {
		t.Fatalf("result = %#v, want echoed stamp and one heading", result)
	}
}

func TestPromptTextDecorationMismatchReturnsExplicitEmptyClear(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 2, Text: "md`# Current`",
	})
	params, err := json.Marshal(protocol.PromptTextDecorationParams{
		ProtocolVersion: protocol.PromptTextProtocolVersion,
		URI:             uri, OpenEpoch: 1, Version: 1,
		SourceHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})
	if err != nil {
		t.Fatal(err)
	}

	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("32"),
		Method: protocol.MethodPromptTextDecorations, Params: params,
	})
	result, ok := response.Result.(protocol.PromptTextDecorationResult)
	if !ok || result.Decorations == nil || len(result.Decorations) != 0 {
		t.Fatalf("mismatch result = %#v, want explicit empty clear", response.Result)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(encoded, []byte(`"decorations":[]`)) {
		t.Fatalf("clear JSON = %s, want explicit empty array", encoded)
	}
}

type promptTextHandlerWorkspace struct {
	workspaceController
	result lsprompttext.Result
}

func (*promptTextHandlerWorkspace) Close() {}

func (w *promptTextHandlerWorkspace) PromptText(
	context.Context,
	protocol.DocumentURI,
	string,
) lsprompttext.Result {
	return w.result
}
