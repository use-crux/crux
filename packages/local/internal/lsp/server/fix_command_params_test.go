package server

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestExecuteFixRejectsInvalidArgumentShapes(t *testing.T) {
	for _, test := range []struct {
		name   string
		params string
	}{
		{name: "malformed", params: `{`},
		{name: "unknown command", params: `{"command":"crux.unknown","arguments":[{"scopeRoot":"/repo","findingId":"finding","fixIndex":0}]}`},
		{name: "unknown top-level field", params: `{"command":"crux.runFix","arguments":[{"scopeRoot":"/repo","findingId":"finding","fixIndex":0}],"extra":true}`},
		{name: "missing arguments", params: `{"command":"crux.runFix"}`},
		{name: "two arguments", params: `{"command":"crux.runFix","arguments":[{},{}]}`},
		{name: "non-object argument", params: `{"command":"crux.runFix","arguments":["finding"]}`},
		{name: "unknown argument field", params: `{"command":"crux.runFix","arguments":[{"scopeRoot":"/repo","findingId":"finding","fixIndex":0,"command":"crux runtime generate"}]}`},
		{name: "relative root", params: `{"command":"crux.runFix","arguments":[{"scopeRoot":"repo","findingId":"finding","fixIndex":0}]}`},
		{name: "empty finding", params: `{"command":"crux.runFix","arguments":[{"scopeRoot":"/repo","findingId":"","fixIndex":0}]}`},
		{name: "missing fix index", params: `{"command":"crux.runFix","arguments":[{"scopeRoot":"/repo","findingId":"finding"}]}`},
		{name: "negative fix index", params: `{"command":"crux.runFix","arguments":[{"scopeRoot":"/repo","findingId":"finding","fixIndex":-1}]}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := New(Options{})
			result := server.Handle(context.Background(), protocol.Request{
				JSONRPC: protocol.JSONRPCVersion,
				ID:      []byte("1"),
				Method:  protocol.MethodExecuteCommand,
				Params:  []byte(test.params),
			})
			assertResponseError(t, result, protocol.InvalidParamsCode, "Invalid execute command params")
		})
	}
}

func TestExecuteFixRejectsUntrustedAndStaleRequests(t *testing.T) {
	finding := commandFinding()
	for _, test := range []struct {
		name        string
		trusted     bool
		present     bool
		fixIndex    int
		wantMessage string
	}{
		{name: "untrusted", present: true, wantMessage: "workspace is not trusted"},
		{name: "missing finding", trusted: true, wantMessage: "finding no longer present — it may have been fixed"},
		{name: "stale fix index", trusted: true, present: true, fixIndex: 1, wantMessage: "finding no longer present — it may have been fixed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			workspace := &commandWorkspace{root: "/repo", finding: finding, present: test.present}
			server := initializedCommandServer(t, workspace, test.trusted, Options{})
			result := executeFixRequest(server, "/repo", finding.ID, test.fixIndex)
			assertResponseError(t, result, protocol.RequestFailedCode, test.wantMessage)
		})
	}
}

func executeFixRequest(server *Server, root, findingID string, fixIndex int) jsonrpc.HandlerResult {
	params, _ := json.Marshal(protocol.ExecuteCommandParams{
		Command: runFixCommand,
		Arguments: []any{map[string]any{
			"scopeRoot": root,
			"findingId": findingID,
			"fixIndex":  fixIndex,
		}},
	})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("2"),
		Method:  protocol.MethodExecuteCommand,
		Params:  params,
	})
	if result.Deferred != nil {
		return result.Deferred()
	}
	return result
}

func initializedCommandServer(t *testing.T, workspace workspaceController, trusted bool, options Options) *Server {
	t.Helper()
	server := New(options)
	server.workspace = workspace
	params, _ := json.Marshal(protocol.InitializeParams{
		RootURI:               "file:///repo",
		InitializationOptions: json.RawMessage(`{"workspaceTrust":` + boolJSON(trusted) + `}`),
	})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params:  params,
	})
	if result.Error != nil {
		t.Fatalf("initialize: %#v", result.Error)
	}
	return server
}

func boolJSON(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func commandFinding() api.IndexLintFinding {
	return api.IndexLintFinding{
		ID: "finding",
		Fixes: []api.IndexLintFix{{
			Title: "Regenerate runtime artifacts", Command: allowedRuntimeGenerateCommand,
		}},
	}
}

type commandWorkspace struct {
	actionWorkspace
	root    string
	finding api.IndexLintFinding
	present bool
}

func (w *commandWorkspace) FindingForScope(root, id string) (api.IndexLintFinding, bool) {
	if !w.present || root != w.root || id != w.finding.ID {
		return api.IndexLintFinding{}, false
	}
	return w.finding, true
}

func (w *commandWorkspace) FindingForURI(uri protocol.DocumentURI, id string) (string, api.IndexLintFinding, bool) {
	if uri != "file:///repo/source.ts" {
		return "", api.IndexLintFinding{}, false
	}
	finding, ok := w.FindingForScope(w.root, id)
	return w.root, finding, ok
}

func assertResponseError(t *testing.T, result jsonrpc.HandlerResult, code int, message string) {
	t.Helper()
	if result.Error == nil || result.Error.Code != code || result.Error.Message != message {
		t.Fatalf("response = %#v, want error (%d, %q)", result, code, message)
	}
}
