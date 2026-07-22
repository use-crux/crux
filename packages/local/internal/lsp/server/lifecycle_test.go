package server

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestScriptedLifecycleMatchesGoldenTranscript(t *testing.T) {
	t.Parallel()

	input := bytes.NewReader(readTranscript(t, "lifecycle.input"))
	var output bytes.Buffer
	var logs bytes.Buffer
	server := New(Options{Version: "0.6.0-test", Root: "/fallback", Logs: &logs})

	if err := jsonrpc.Serve(context.Background(), input, &output, &logs, server); err != nil {
		t.Fatalf("serve lifecycle: %v", err)
	}
	if server.ExitCode() != 0 {
		t.Fatalf("exit code = %d, want 0 after shutdown then exit", server.ExitCode())
	}
	want := readTranscript(t, "lifecycle.output")
	if !bytes.Equal(output.Bytes(), want) {
		t.Fatalf("lifecycle transcript mismatch\n--- got ---\n%q\n--- want ---\n%q", output.Bytes(), want)
	}
	if !strings.Contains(logs.String(), "file:///repo") {
		t.Fatalf("initialized log = %q, want detected workspace folder", logs.String())
	}
}

func TestExitWithoutShutdownRequestsFailureExitCode(t *testing.T) {
	t.Parallel()

	var input bytes.Buffer
	if err := jsonrpc.NewWriter(&input).Write([]byte(`{"jsonrpc":"2.0","method":"exit"}`)); err != nil {
		t.Fatal(err)
	}
	server := New(Options{})
	if err := jsonrpc.Serve(context.Background(), &input, io.Discard, io.Discard, server); err != nil {
		t.Fatalf("serve exit: %v", err)
	}
	if server.ExitCode() != 1 {
		t.Fatalf("exit code = %d, want 1 without shutdown", server.ExitCode())
	}
}

func TestUnknownRequestGetsMethodNotFoundAndUnknownNotificationIsIgnored(t *testing.T) {
	t.Parallel()

	var input bytes.Buffer
	for _, payload := range [][]byte{
		[]byte(`{"jsonrpc":"2.0","method":"crux/unknownNotification"}`),
		[]byte(`{"jsonrpc":"2.0","id":7,"method":"crux/unknownRequest"}`),
	} {
		if err := jsonrpc.NewWriter(&input).Write(payload); err != nil {
			t.Fatal(err)
		}
	}
	var output bytes.Buffer
	server := New(Options{})
	if err := jsonrpc.Serve(context.Background(), &input, &output, io.Discard, server); err != nil {
		t.Fatalf("serve unknown methods: %v", err)
	}
	payload, err := jsonrpc.NewReader(&output).Read()
	if err != nil {
		t.Fatalf("read unknown request response: %v", err)
	}
	if got := string(payload); got != `{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"Method not found"}}` {
		t.Fatalf("unknown request response = %s", got)
	}
}

func TestStdinEOFCancelsInitializedScopeContext(t *testing.T) {
	t.Parallel()

	var input bytes.Buffer
	for _, payload := range [][]byte{
		[]byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"rootUri":"file:///repo"}}`),
		[]byte(`{"jsonrpc":"2.0","method":"initialized"}`),
	} {
		if err := jsonrpc.NewWriter(&input).Write(payload); err != nil {
			t.Fatal(err)
		}
	}
	var scopeContext context.Context
	server := New(Options{OnInitialized: func(ctx context.Context, _ []protocol.WorkspaceFolder) {
		scopeContext = ctx
	}})
	if err := jsonrpc.Serve(context.Background(), &input, io.Discard, io.Discard, server); err != nil {
		t.Fatalf("serve until EOF: %v", err)
	}
	if scopeContext == nil {
		t.Fatal("initialized hook did not receive a scope context")
	}
	select {
	case <-scopeContext.Done():
	default:
		t.Fatal("stdin EOF did not cancel the scope context")
	}
}

func TestInitializeFolderPrecedence(t *testing.T) {
	t.Parallel()

	folders := initializeFolders(protocol.InitializeParams{
		WorkspaceFolders: []protocol.WorkspaceFolder{{URI: "file:///workspace", Name: "workspace"}},
		RootURI:          "file:///root-uri",
	}, "/flag-root")
	if len(folders) != 1 || folders[0].URI != "file:///workspace" {
		t.Fatalf("workspace folders = %#v, want workspaceFolders to win", folders)
	}

	folders = initializeFolders(protocol.InitializeParams{RootURI: "file:///root-uri"}, "/flag-root")
	if len(folders) != 1 || folders[0].URI != "file:///root-uri" {
		t.Fatalf("rootUri folders = %#v, want rootUri to win over --root", folders)
	}

	folders = initializeFolders(protocol.InitializeParams{}, "/flag-root")
	if len(folders) != 1 || folders[0].URI != "file:///flag-root" {
		t.Fatalf("fallback folders = %#v, want --root fallback", folders)
	}

	folders = initializeFolders(protocol.InitializeParams{}, `C:\repo`)
	if len(folders) != 1 || folders[0].URI != "file:///C:/repo" {
		t.Fatalf("Windows fallback folders = %#v, want RFC 3986 file URI", folders)
	}
}

func TestInitializeAdvertisesIncrementalDocumentSync(t *testing.T) {
	t.Parallel()

	result := New(Options{}).Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params:  []byte(`{}`),
	})
	initialize, ok := result.Result.(protocol.InitializeResult)
	if !ok {
		t.Fatalf("initialize result = %#v, want protocol.InitializeResult", result.Result)
	}
	if got := initialize.Capabilities.TextDocumentSync.Change; got != protocol.SyncIncremental {
		t.Fatalf("text document sync change = %d, want incremental (%d)", got, protocol.SyncIncremental)
	}
}

func TestInitializeAdvertisesRunFixCommand(t *testing.T) {
	t.Parallel()

	result := New(Options{}).Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params:  []byte(`{}`),
	})
	initialize, ok := result.Result.(protocol.InitializeResult)
	if !ok {
		t.Fatalf("initialize result = %#v, want protocol.InitializeResult", result.Result)
	}
	want := []string{"crux.runFix"}
	if !reflect.DeepEqual(initialize.Capabilities.ExecuteCommandProvider.Commands, want) {
		t.Fatalf("execute commands = %v, want %v", initialize.Capabilities.ExecuteCommandProvider.Commands, want)
	}
}

func TestInitializeAdvertisesHoverAndNegotiatesContentFormat(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"textDocument":{"hover":{"contentFormat":["plaintext","markdown"]}}}
		}`),
	})
	initialize, ok := result.Result.(protocol.InitializeResult)
	if !ok {
		t.Fatalf("initialize result = %#v, want protocol.InitializeResult", result.Result)
	}
	if !initialize.Capabilities.HoverProvider {
		t.Fatal("hover provider was not advertised")
	}
	if server.hoverFormat != protocol.MarkupKindMarkdown {
		t.Fatalf("negotiated hover format = %q, want markdown", server.hoverFormat)
	}

	plaintext := New(Options{})
	plaintext.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params:  []byte(`{"capabilities":{"textDocument":{"hover":{"contentFormat":["plaintext"]}}}}`),
	})
	if plaintext.hoverFormat != protocol.MarkupKindPlainText {
		t.Fatalf("plaintext hover format = %q, want plaintext", plaintext.hoverFormat)
	}
}

func TestShutdownCancelsInitializedScopes(t *testing.T) {
	t.Parallel()

	rootContext, cancel := context.WithCancel(context.Background())
	defer cancel()
	var scopeContext context.Context
	server := New(Options{OnInitialized: func(ctx context.Context, _ []protocol.WorkspaceFolder) {
		scopeContext = ctx
	}})
	server.Handle(rootContext, protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params:  []byte(`{"rootUri":"file:///repo"}`),
	})
	server.Handle(rootContext, protocol.Request{JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodInitialized})
	if scopeContext == nil {
		t.Fatal("initialized hook did not receive a scope context")
	}
	server.Handle(rootContext, protocol.Request{JSONRPC: protocol.JSONRPCVersion, ID: []byte("2"), Method: protocol.MethodShutdown})
	select {
	case <-scopeContext.Done():
	default:
		t.Fatal("shutdown did not cancel initialized scopes")
	}
}

func TestWrongDirectionMethodsUseFallbackBehavior(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	shutdownNotification := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodShutdown,
	})
	if shutdownNotification.Stop || server.shutdown {
		t.Fatal("shutdown notification changed lifecycle state")
	}
	exitRequest := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodExit,
	})
	if exitRequest.Stop || exitRequest.Error == nil || exitRequest.Error.Code != protocol.MethodNotFoundCode {
		t.Fatalf("exit request result = %#v, want MethodNotFound without stopping", exitRequest)
	}
}

func readTranscript(t *testing.T, name string) []byte {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read transcript %s: %v", name, err)
	}
	decoded, err := strconv.Unquote(strings.TrimSpace(string(content)))
	if err != nil {
		t.Fatalf("decode transcript %s: %v", name, err)
	}
	return []byte(decoded)
}
