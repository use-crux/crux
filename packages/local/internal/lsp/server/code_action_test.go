package server

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestCodeActionRunFixOrderingMatchesGolden(t *testing.T) {
	server := New(Options{})
	server.clientInfo = &protocol.ClientInfo{Name: "Visual Studio Code"}
	server.workspace = &commandWorkspace{
		actionWorkspace: actionWorkspace{indent: "  "},
		root:            "/repo",
		finding:         commandFindingWithSuppression(),
		present:         true,
	}
	diagnostic := commandActionDiagnostic(allowedRuntimeGenerateCommand)
	actions := requestActions(t, server, diagnostic)
	encoded, err := json.MarshalIndent(actions, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join("testdata", "code-actions-run-fix.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded)+"\n" != string(want) {
		t.Fatalf("code actions mismatch\n--- got ---\n%s\n--- want ---\n%s", encoded, want)
	}
}

func TestCodeActionRunFixPreflightUsesTrustedStoreCopy(t *testing.T) {
	for _, test := range []struct {
		name           string
		trusted        bool
		diagnosticCmd  string
		storeCmd       string
		present        bool
		wantRunActions int
	}{
		{name: "allowed", trusted: true, diagnosticCmd: allowedRuntimeGenerateCommand, storeCmd: allowedRuntimeGenerateCommand, present: true, wantRunActions: 1},
		{name: "untrusted", diagnosticCmd: allowedRuntimeGenerateCommand, storeCmd: allowedRuntimeGenerateCommand, present: true},
		{name: "wire fix has no command", trusted: true, storeCmd: allowedRuntimeGenerateCommand, present: true},
		{name: "store fix has no command", trusted: true, diagnosticCmd: allowedRuntimeGenerateCommand, present: true},
		{name: "store command rejected", trusted: true, diagnosticCmd: allowedRuntimeGenerateCommand, storeCmd: "crux runtime inspect", present: true},
		{name: "finding stale", trusted: true, diagnosticCmd: allowedRuntimeGenerateCommand, storeCmd: allowedRuntimeGenerateCommand},
	} {
		t.Run(test.name, func(t *testing.T) {
			finding := commandFinding()
			finding.Fixes[0].Command = test.storeCmd
			workspace := &commandWorkspace{root: "/repo", finding: finding, present: test.present}
			server := initializedCommandServer(t, workspace, test.trusted, Options{})
			actions := requestActions(t, server, commandActionDiagnostic(test.diagnosticCmd))
			count := 0
			for _, action := range actions {
				if action.Command != nil && action.Command.Command == runFixCommand {
					count++
				}
			}
			if count != test.wantRunActions {
				t.Fatalf("run-fix actions = %d, want %d; actions = %#v", count, test.wantRunActions, actions)
			}
		})
	}
}

func TestCodeActionReturnsIndentedSuppressThenVSCodeDocs(t *testing.T) {
	for _, test := range []struct {
		name   string
		indent string
	}{
		{name: "spaces", indent: "    "},
		{name: "tabs", indent: "\t\t"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := initializedActionServer("Visual Studio Code - Insiders", test.indent)
			diagnostic := actionDiagnostic(true, "next-line", false, "crux")
			actions := requestActions(t, server, diagnostic)
			if len(actions) != 2 {
				t.Fatalf("actions = %#v, want suppress and docs", actions)
			}
			if actions[0].Title != "Suppress test.rule for this line" || actions[0].Edit == nil {
				t.Fatalf("suppress action = %#v", actions[0])
			}
			edit := actions[0].Edit.Changes["file:///repo/source.ts"][0]
			if edit.Range.Start.Line != 2 || edit.Range.Start.Character != 0 || edit.Range != (protocol.Range{Start: protocol.Position{Line: 2}, End: protocol.Position{Line: 2}}) {
				t.Fatalf("suppress edit range = %#v", edit.Range)
			}
			wantText := test.indent + "// exact test directive\n"
			if edit.NewText != wantText {
				t.Fatalf("suppress edit = %q, want %q", edit.NewText, wantText)
			}
			if actions[1].Command == nil || actions[1].Command.Command != "crux.openDocs" || !reflect.DeepEqual(actions[1].Command.Arguments, []any{"https://usecrux.dev/rule"}) {
				t.Fatalf("docs action = %#v", actions[1])
			}
		})
	}
}

func TestCodeActionEligibilityMatrix(t *testing.T) {
	for _, test := range []struct {
		name       string
		client     string
		diagnostic protocol.Diagnostic
		wantTitles []string
	}{
		{name: "unsupported suppression keeps docs", client: "Visual Studio Code", diagnostic: actionDiagnostic(false, "next-line", false, "crux"), wantTitles: []string{"Open test.rule documentation"}},
		{name: "unknown scope keeps docs", client: "Visual Studio Code", diagnostic: actionDiagnostic(true, "file", false, "crux"), wantTitles: []string{"Open test.rule documentation"}},
		{name: "suppressed keeps docs", client: "Visual Studio Code", diagnostic: actionDiagnostic(true, "next-line", true, "crux"), wantTitles: []string{"Open test.rule documentation"}},
		{name: "non vscode keeps suppress", client: "Neovim", diagnostic: actionDiagnostic(true, "next-line", false, "crux"), wantTitles: []string{"Suppress test.rule for this line"}},
		{name: "non crux ignored", client: "Visual Studio Code", diagnostic: actionDiagnostic(true, "next-line", false, "typescript")},
	} {
		t.Run(test.name, func(t *testing.T) {
			actions := requestActions(t, initializedActionServer(test.client, ""), test.diagnostic)
			titles := make([]string, len(actions))
			for index := range actions {
				titles[index] = actions[index].Title
			}
			if !reflect.DeepEqual(titles, test.wantTitles) && !(len(titles) == 0 && len(test.wantTitles) == 0) {
				t.Fatalf("action titles = %v, want %v", titles, test.wantTitles)
			}
		})
	}
}

func TestCodeActionIgnoresNonCruxDiagnosticWithNumericCode(t *testing.T) {
	server := initializedActionServer("Cursor", "")
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("2"),
		Method:  protocol.MethodCodeAction,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/source.ts"},
			"range":{"start":{"line":2,"character":0},"end":{"line":2,"character":0}},
			"context":{"diagnostics":[{
				"range":{"start":{"line":2,"character":0},"end":{"line":2,"character":4}},
				"code":2307,
				"source":"typescript",
				"message":"Cannot find module"
			}]}
		}`),
	})

	if result.Error != nil {
		t.Fatalf("numeric diagnostic code rejected: %#v", result.Error)
	}
	actions, ok := result.Result.([]protocol.CodeAction)
	if !ok || len(actions) != 0 {
		t.Fatalf("actions = %#v, want empty result", result.Result)
	}
}

func actionDiagnostic(supported bool, scope string, suppressed bool, source string) protocol.Diagnostic {
	data, _ := json.Marshal(struct {
		ID          string                    `json:"id"`
		RuleID      string                    `json:"ruleId"`
		Suppression *api.IndexLintSuppression `json:"suppression"`
	}{
		ID: "finding", RuleID: "test.rule",
		Suppression: &api.IndexLintSuppression{Supported: supported, Scope: scope, Directive: "// exact test directive"},
	})
	diagnostic := protocol.Diagnostic{
		Range: protocol.Range{
			Start: protocol.Position{Line: 2, Character: 4},
			End:   protocol.Position{Line: 2, Character: 8},
		},
		Code: "test.rule", Source: source, Message: "Finding", Data: data,
		CodeDescription: &protocol.CodeDescription{Href: "https://usecrux.dev/rule"},
	}
	if suppressed {
		diagnostic.Tags = []protocol.DiagnosticTag{protocol.DiagnosticTagUnnecessary}
	}
	return diagnostic
}

func commandFindingWithSuppression() api.IndexLintFinding {
	finding := commandFinding()
	finding.RuleID = "test.rule"
	finding.Suppression = &api.IndexLintSuppression{
		Supported: true, Scope: "next-line", Directive: "// exact test directive",
	}
	return finding
}

func commandActionDiagnostic(command string) protocol.Diagnostic {
	diagnostic := actionDiagnostic(true, "next-line", false, "crux")
	data, _ := json.Marshal(struct {
		ID          string                    `json:"id"`
		RuleID      string                    `json:"ruleId"`
		Fixes       []api.IndexLintFix        `json:"fixes"`
		Suppression *api.IndexLintSuppression `json:"suppression"`
	}{
		ID: "finding", RuleID: "test.rule",
		Fixes: []api.IndexLintFix{{Title: "Regenerate runtime artifacts", Command: command}},
		Suppression: &api.IndexLintSuppression{
			Supported: true, Scope: "next-line", Directive: "// exact test directive",
		},
	})
	diagnostic.Data = data
	return diagnostic
}

func initializedActionServer(client, indent string) *Server {
	server := New(Options{})
	server.workspace = &actionWorkspace{indent: indent}
	params, _ := json.Marshal(protocol.InitializeParams{
		ClientInfo: &protocol.ClientInfo{Name: client},
		RootURI:    "file:///repo",
	})
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize, Params: params,
	})
	return server
}

func requestActions(t *testing.T, server *Server, diagnostic protocol.Diagnostic) []protocol.CodeAction {
	t.Helper()
	params, _ := json.Marshal(protocol.CodeActionParams{
		TextDocument: protocol.TextDocumentIdentifier{URI: "file:///repo/source.ts"},
		Context:      protocol.CodeActionContext{Diagnostics: []protocol.Diagnostic{diagnostic}},
	})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("2"), Method: protocol.MethodCodeAction, Params: params,
	})
	actions, ok := result.Result.([]protocol.CodeAction)
	if !ok {
		t.Fatalf("code action result = %#v", result)
	}
	return actions
}

type actionWorkspace struct{ indent string }

func (w *actionWorkspace) Start(context.Context, []protocol.WorkspaceFolder, Settings) {}
func (w *actionWorkspace) UpdateSettings(Settings)                                     {}
func (w *actionWorkspace) DidOpen(protocol.DocumentURI, int)                           {}
func (w *actionWorkspace) DidChange(protocol.DocumentURI, int, []protocol.TextDocumentContentChangeEvent) {
}
func (w *actionWorkspace) DidSave(protocol.DocumentURI)  {}
func (w *actionWorkspace) DidClose(protocol.DocumentURI) {}
func (w *actionWorkspace) DisplayedFindings(protocol.DocumentURI, protocol.Position) []displayedFinding {
	return nil
}
func (w *actionWorkspace) Close() {}
func (w *actionWorkspace) LeadingWhitespace(uri protocol.DocumentURI, _ uint32) (string, bool) {
	return w.indent, uri == "file:///repo/source.ts"
}
