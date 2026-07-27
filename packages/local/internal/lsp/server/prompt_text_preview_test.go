package server

import (
	"context"
	"encoding/json"
	"testing"

	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextStaticPreviewEchoesExactReadyResult(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 7, Text: "md`# Hello`",
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	server.workspace = &promptTextPreviewHandlerWorkspace{result: lsprompttext.PreviewResult{
		Revision: document.Revision,
		Kind:     lsprompttext.PreviewResultReady,
		Selection: lsprompttext.PreviewSelection{
			Ordinal: 0,
			Range: protocol.Range{
				Start: protocol.Position{Character: 0},
				End:   protocol.Position{Character: 11},
			},
		},
		RequestStatus:  staticprotocol.PromptTextStatusComplete,
		TemplateStatus: staticprotocol.PromptTextStatusTruncated,
		PreviewStatus:  staticprotocol.PromptTextPreviewTruncated,
		Evidence:       staticprotocol.PromptTextPreviewSyntaxExact,
		Text:           "# Hello",
		Truncation: &staticprotocol.PromptTextPreviewTruncation{
			Reason: staticprotocol.PromptTextTruncatedByPreviewBytes,
			Limit:  7, EmittedBytes: 7,
		},
	}}
	params, err := json.Marshal(protocol.PromptTextPreviewStaticParams{
		ProtocolVersion: protocol.PromptTextProtocolVersion,
		URI:             uri,
		OpenEpoch:       document.Revision.OpenEpoch,
		Version:         document.Revision.Version,
		SourceHash:      document.Revision.SourceHash,
		Target: protocol.PromptTextPreviewTarget{
			Kind:     protocol.PromptTextPreviewTargetPosition,
			Position: &protocol.Position{Character: 4},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("71"),
		Method: protocol.MethodPromptTextPreviewStatic, Params: params,
	})
	if response.Deferred == nil {
		t.Fatal("static preview analysis blocked the dispatcher")
	}
	response = response.Deferred()
	result, ok := response.Result.(protocol.PromptTextPreviewReadyResult)
	if !ok ||
		result.URI != uri ||
		result.OpenEpoch != document.Revision.OpenEpoch ||
		result.Version != document.Revision.Version ||
		result.SourceHash != document.Revision.SourceHash ||
		result.Kind != protocol.PromptTextPreviewResultReady ||
		result.TemplateStatus != protocol.PromptTextPreviewStructuralTruncated ||
		result.PreviewStatus != protocol.PromptTextPreviewContentTruncated ||
		result.Truncation == nil ||
		result.Truncation.Reason != "max-preview-bytes" {
		t.Fatalf("ready result = %#v", response.Result)
	}
}

func TestPromptTextStaticPreviewRejectsForeignParams(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("72"),
		Method: protocol.MethodPromptTextPreviewStatic,
		Params: json.RawMessage(`{
			"protocolVersion":1,
			"uri":"file:///repo/writer.ts",
			"openEpoch":1,
			"version":1,
			"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"target":{"kind":"position","position":{"line":0,"character":0,"foreign":true}}
		}`),
	})
	if response.Error == nil || response.Error.Code != protocol.InvalidParamsCode {
		t.Fatalf("foreign params result = %#v", response)
	}
}

func TestPromptTextStaticPreviewReturnsLifecycleUnavailableReasons(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/writer.ts")
	server := New(Options{})
	missing := validStaticPreviewParams(t, uri, 1, 1, "a")
	response := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("73"),
		Method: protocol.MethodPromptTextPreviewStatic, Params: missing,
	})
	assertStaticPreviewReason(t, response.Result, protocol.PromptTextPreviewDocumentNotOpen)

	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 7, Text: "md`# Hello`",
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	stale := validStaticPreviewParams(
		t,
		uri,
		document.Revision.OpenEpoch,
		document.Revision.Version+1,
		document.Revision.SourceHash,
	)
	response = server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("74"),
		Method: protocol.MethodPromptTextPreviewStatic, Params: stale,
	})
	assertStaticPreviewReason(t, response.Result, protocol.PromptTextPreviewRevisionMismatch)

	current := validStaticPreviewParams(
		t,
		uri,
		document.Revision.OpenEpoch,
		document.Revision.Version,
		document.Revision.SourceHash,
	)
	response = server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("75"),
		Method: protocol.MethodPromptTextPreviewStatic, Params: current,
	})
	assertStaticPreviewReason(t, response.Result, protocol.PromptTextPreviewAnalysisUnavailable)
}

func TestPromptTextStaticPreviewMapsOnlyClosedServerReasons(t *testing.T) {
	t.Parallel()

	for _, reason := range []protocol.PromptTextPreviewUnavailableReason{
		protocol.PromptTextPreviewRequestUnsupported,
		protocol.PromptTextPreviewTemplateNotFound,
		protocol.PromptTextPreviewTemplateAmbiguous,
		protocol.PromptTextPreviewTemplateUnsupported,
		protocol.PromptTextPreviewUnavailable,
	} {
		if got := previewUnavailableReason(string(reason)); got != reason {
			t.Fatalf("reason %q mapped to %q", reason, got)
		}
	}
	if got := previewUnavailableReason("foreign"); got !=
		protocol.PromptTextPreviewAnalysisUnavailable {
		t.Fatalf("foreign reason mapped to %q", got)
	}
}

func validStaticPreviewParams(
	t *testing.T,
	uri protocol.DocumentURI,
	openEpoch uint64,
	version int64,
	sourceHash string,
) json.RawMessage {
	t.Helper()
	if len(sourceHash) != 64 {
		sourceHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	}
	value, err := json.Marshal(protocol.PromptTextPreviewStaticParams{
		ProtocolVersion: protocol.PromptTextProtocolVersion,
		URI:             uri,
		OpenEpoch:       openEpoch,
		Version:         version,
		SourceHash:      sourceHash,
		Target: protocol.PromptTextPreviewTarget{
			Kind:     protocol.PromptTextPreviewTargetPosition,
			Position: &protocol.Position{},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func assertStaticPreviewReason(
	t *testing.T,
	value any,
	reason protocol.PromptTextPreviewUnavailableReason,
) {
	t.Helper()
	result, ok := value.(protocol.PromptTextPreviewUnavailableResult)
	if !ok || result.Reason != reason {
		t.Fatalf("static preview result = %#v", value)
	}
}

type promptTextPreviewHandlerWorkspace struct {
	workspaceController
	result lsprompttext.PreviewResult
}

func (*promptTextPreviewHandlerWorkspace) Close() {}

func (w *promptTextPreviewHandlerWorkspace) PromptTextStaticPreview(
	context.Context,
	protocol.DocumentURI,
	string,
	lsprompttext.PreviewTarget,
) lsprompttext.PreviewResult {
	return w.result
}
