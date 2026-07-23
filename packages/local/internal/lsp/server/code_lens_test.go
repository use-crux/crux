package server

import (
	"context"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestCodeLensHandlerMakesDeclaredCursorClientClickable(t *testing.T) {
	t.Parallel()

	workspace := &codeLensWorkspaceStub{
		attached: true,
		port:     4603,
		summaries: []definitionSummary{{
			Definition: documentDefinition{
				Definition: api.ProjectDefinition{
					ID: "prompt:writer", Name: "Writer", Kind: "prompt",
				},
				Range: protocol.Range{
					Start: protocol.Position{Line: 4, Character: 22},
					End:   protocol.Position{Line: 8, Character: 2},
				},
			},
			FindingCount: 1,
		}},
	}
	server := New(Options{})
	server.workspace = workspace
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"clientInfo":{"name":"Cursor"},
			"initializationOptions":{"clientCommands":{"openDevtools":true}}
		}`),
	})

	result := server.Handle(context.Background(), codeLensRequest("2"))
	lenses, ok := result.Result.([]protocol.CodeLens)
	if result.Error != nil || !ok || len(lenses) != 1 {
		t.Fatalf("code lenses = %#v, error %#v", result.Result, result.Error)
	}
	lens := lenses[0]
	wantRange := protocol.Range{
		Start: protocol.Position{Line: 4}, End: protocol.Position{Line: 4},
	}
	if lens.Range != wantRange || lens.Command == nil {
		t.Fatalf("lens = %#v, want first-line range and command", lens)
	}
	if lens.Command.Title != "Crux: 1 finding" || lens.Command.Command != "crux.openDevtools" {
		t.Fatalf("lens command = %#v", lens.Command)
	}
	if len(lens.Command.Arguments) != 1 || lens.Command.Arguments[0] !=
		"http://localhost:4603/library/index/prompt%3Awriter" {
		t.Fatalf("lens arguments = %#v", lens.Command.Arguments)
	}
}

func TestCodeLensHandlerDoesNotInferCommandFromClientName(t *testing.T) {
	t.Parallel()

	workspace := &codeLensWorkspaceStub{
		attached: true,
		port:     4603,
		summaries: []definitionSummary{{
			Definition: documentDefinition{
				Definition: api.ProjectDefinition{ID: "prompt:writer", Kind: "prompt"},
			},
			FindingCount: 1,
		}},
	}
	server := New(Options{})
	server.workspace = workspace
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{"clientInfo":{"name":"Visual Studio Code"}}`),
	})
	result := server.Handle(context.Background(), codeLensRequest("2"))
	lenses, ok := result.Result.([]protocol.CodeLens)
	if !ok || len(lenses) != 1 || lenses[0].Command == nil ||
		lenses[0].Command.Command != "" || lenses[0].Command.Title == "" {
		t.Fatalf("undeclared client lenses = %#v, want titled informational lens", result.Result)
	}
}

func TestCodeLensHandlerHonorsSettingAndRejectsMissingURI(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	server.workspace = &codeLensWorkspaceStub{summaries: []definitionSummary{{FindingCount: 1}}}
	server.settings.CodeLensEnabled = false
	result := server.Handle(context.Background(), codeLensRequest("1"))
	lenses, ok := result.Result.([]protocol.CodeLens)
	if result.Error != nil || !ok || lenses == nil || len(lenses) != 0 {
		t.Fatalf("disabled lenses = %#v, error %#v", result.Result, result.Error)
	}
	result = server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("2"), Method: protocol.MethodCodeLens,
		Params: []byte(`{"textDocument":{}}`),
	})
	if result.Error == nil || result.Error.Code != protocol.InvalidParamsCode {
		t.Fatalf("missing URI result = %#v, want invalid params", result)
	}
}

func TestBuildCodeLensesKeepsInformationalTitleAndOmitsFindingless(t *testing.T) {
	t.Parallel()

	summaries := []definitionSummary{
		{
			Definition: documentDefinition{
				Definition: api.ProjectDefinition{ID: "agent:writer", Kind: "agent"},
				Range:      protocol.Range{Start: protocol.Position{Line: 3, Character: 8}},
			},
			FindingCount: 2,
		},
		{
			Definition: documentDefinition{
				Definition: api.ProjectDefinition{ID: "tool:clean", Kind: "tool"},
				Range:      protocol.Range{Start: protocol.Position{Line: 8}},
			},
		},
	}
	lenses := buildCodeLenses(summaries, false, 4603)
	if len(lenses) != 1 || lenses[0].Command == nil {
		t.Fatalf("informational lenses = %#v", lenses)
	}
	command := lenses[0].Command
	if command.Title != "Crux: 2 findings" || command.Command != "" || command.Arguments != nil {
		t.Fatalf("informational command = %#v", command)
	}
}

func TestWorkspaceCodeLensesFollowScopeModeAndPort(t *testing.T) {
	t.Parallel()

	store, publisher, recorder, uri, file := newViewPublisher(t)
	column := 1
	definition := viewDefinition("prompt:writer", file, 3, &column, nil)
	finding := viewFinding("finding", file, 3)
	finding.PrimaryDefinitionID = definition.ID
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition}, Findings: []api.IndexLintFinding{finding},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.wait(t, 1)
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: publisher.options.Root},
		mode:  readmodel.ModeOwn, publisher: publisher,
	}
	workspace := &workspaceRuntime{
		settings: Settings{Port: 4603}, sessions: []*scopeSession{session},
	}

	own := workspace.CodeLenses(uri, true)
	if len(own) != 1 || own[0].Command == nil || own[0].Command.Command != "" {
		t.Fatalf("own lenses = %#v, want informational", own)
	}
	session.mode = readmodel.ModeAttached
	attached := workspace.CodeLenses(uri, true)
	if len(attached) != 1 || attached[0].Command == nil ||
		attached[0].Command.Command != openDevtoolsCommand {
		t.Fatalf("attached lenses = %#v, want clickable", attached)
	}
}

func TestDefinitionDevtoolsURLUsesVerifiedCatalogRoutes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		kind string
		id   string
		name string
		want string
	}{
		{kind: "prompt", id: "prompt:writer/primary", want: "http://localhost:4603/library/index/prompt%3Awriter%2Fprimary"},
		{kind: "context", id: "context:account", want: "http://localhost:4603/library/index/context/context%3Aaccount"},
		{kind: "tool", id: "tool:account lookup", name: "account lookup", want: "http://localhost:4603/library/index/tool/tool%3Aaccount%20lookup"},
		{kind: "agent", id: "agent:writer", want: "http://localhost:4603/"},
	}
	for _, test := range tests {
		t.Run(test.kind, func(t *testing.T) {
			summary := definitionSummary{Definition: documentDefinition{Definition: api.ProjectDefinition{
				Kind: test.kind, ID: test.id, Name: test.name,
			}}}
			if got := definitionDevtoolsURL(summary, 4603); got != test.want {
				t.Fatalf("URL = %q, want %q", got, test.want)
			}
		})
	}
}

func TestInitializeAdvertisesEagerCodeLensAndMethodDirection(t *testing.T) {
	t.Parallel()

	result := New(Options{}).Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{}`),
	})
	initialize, ok := result.Result.(protocol.InitializeResult)
	if !ok || initialize.Capabilities.CodeLensProvider.ResolveProvider {
		t.Fatalf("initialize result = %#v, want eager code lens provider", result.Result)
	}
	if methodDirectionMatches(protocol.Request{Method: protocol.MethodCodeLens}) {
		t.Fatal("code lens notification direction accepted")
	}
	if !methodDirectionMatches(protocol.Request{ID: []byte("1"), Method: protocol.MethodCodeLens}) {
		t.Fatal("code lens request direction rejected")
	}
}

func codeLensRequest(id string) protocol.Request {
	return protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte(id), Method: protocol.MethodCodeLens,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`),
	}
}

type codeLensWorkspaceStub struct {
	hoverWorkspace
	mu        sync.RWMutex
	summaries []definitionSummary
	attached  bool
	port      int
}

func (w *codeLensWorkspaceStub) CodeLenses(
	_ protocol.DocumentURI,
	canOpenDevtools bool,
) []protocol.CodeLens {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return buildCodeLenses(w.summaries, w.attached && canOpenDevtools, w.port)
}

func (w *codeLensWorkspaceStub) setAttached(attached bool) {
	w.mu.Lock()
	w.attached = attached
	w.mu.Unlock()
}
