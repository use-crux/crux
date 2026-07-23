package server

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestSettingsMergeValidNestedValues(t *testing.T) {
	current := defaultSettings(4400)
	current = mergeSettings(current, []byte(`{
		"crux": {
			"port": 4500,
			"lint": {"profile": "strict", "includeSuppressed": true},
			"inlayHints": {"enabled": false},
			"codeLens": {"enabled": false},
			"trace": "messages"
		}
	}`))
	want := Settings{Port: 4500, Profile: "strict", IncludeSuppressed: true, Trace: "messages", InlayHintsEnabled: false}
	if !reflect.DeepEqual(current, want) {
		t.Fatalf("settings = %#v, want %#v", current, want)
	}

	current = mergeSettings(current, []byte(`{
		"crux": {
			"port": "wrong",
			"lint": {"profile": "unknown", "includeSuppressed": "wrong"},
			"trace": "verbose"
		}
	}`))
	if !reflect.DeepEqual(current, want) {
		t.Fatalf("invalid values changed settings to %#v", current)
	}
}

func TestSettingsDefaultEnablesInlayHintsAndCodeLens(t *testing.T) {
	t.Parallel()

	if settings := defaultSettings(4400); !settings.InlayHintsEnabled {
		t.Fatalf("default settings = %#v, want inlay hints enabled", settings)
	}
	if settings := defaultSettings(4400); !settings.CodeLensEnabled {
		t.Fatalf("default settings = %#v, want code lens enabled", settings)
	}
}

func TestServerRoutesWorkspaceEventsAndSettings(t *testing.T) {
	savedAt := time.Date(2026, 7, 21, 20, 45, 0, 0, time.UTC)
	server := New(Options{Port: 4400, Now: func() time.Time { return savedAt }})
	workspace := &recordingWorkspace{}
	server.workspace = workspace
	ctx := context.Background()

	server.Handle(ctx, protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"rootUri":"file:///repo",
			"initializationOptions":{"crux":{"port":4500,"lint":{"profile":"recommended"}}}
		}`),
	})
	server.Handle(ctx, protocol.Request{JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodInitialized})
	if workspace.started.Port != 4500 || workspace.started.Profile != "recommended" {
		t.Fatalf("started settings = %#v", workspace.started)
	}

	server.Handle(ctx, protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodDidOpen,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/a.ts","languageId":"typescript","version":1,"text":""}}`),
	})
	server.Handle(ctx, protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodDidChange,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/src/a.ts","version":2},
			"contentChanges":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"text":"x"}]
		}`),
	})
	server.Handle(ctx, protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodDidSave,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/a.ts"}}`),
	})
	if workspace.opened != "file:///repo/src/a.ts" || workspace.changedURI != workspace.opened ||
		workspace.changedVersion != 2 || len(workspace.changes) != 1 || workspace.saved != workspace.opened {
		t.Fatalf(
			"document events = open %q change (%q, %d, %#v) save %q",
			workspace.opened,
			workspace.changedURI,
			workspace.changedVersion,
			workspace.changes,
			workspace.saved,
		)
	}
	state, ok := server.documentState(workspace.opened)
	if !ok || !state.Open || !state.SavedAt.Equal(savedAt) {
		t.Fatalf("open saved document state = (%#v, %v)", state, ok)
	}
	server.Handle(ctx, protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodDidClose,
		Params: []byte(`{"textDocument":{"uri":"file:///repo/src/a.ts"}}`),
	})
	if workspace.closed != workspace.opened {
		t.Fatalf("closed URI = %q, want %q", workspace.closed, workspace.opened)
	}
	state, ok = server.documentState(workspace.opened)
	if !ok || state.Open || !state.SavedAt.Equal(savedAt) {
		t.Fatalf("closed document state = (%#v, %v)", state, ok)
	}

	server.Handle(ctx, protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodDidChangeConfiguration,
		Params: []byte(`{"settings":{"crux":{"lint":{"profile":"off","includeSuppressed":true}}}}`),
	})
	if workspace.updated.Port != 4500 || workspace.updated.Profile != "off" || !workspace.updated.IncludeSuppressed {
		t.Fatalf("updated settings = %#v", workspace.updated)
	}
}

func TestTraceMessagesLogsOnlyMethodNames(t *testing.T) {
	server := New(Options{})
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{"initializationOptions":{"crux":{"trace":"messages","secret":"do-not-log"}}}`),
	})
	notification := <-server.Outbound()
	params := notification.Params.(protocol.LogMessageParams)
	if notification.Method != protocol.MethodLogMessage || params.Message != "initialize" {
		t.Fatalf("trace notification = %#v", notification)
	}
}

type recordingWorkspace struct {
	started        Settings
	updated        Settings
	opened         protocol.DocumentURI
	changedURI     protocol.DocumentURI
	changedVersion int
	changes        []protocol.TextDocumentContentChangeEvent
	saved          protocol.DocumentURI
	closed         protocol.DocumentURI
}

func (w *recordingWorkspace) Start(_ context.Context, _ []protocol.WorkspaceFolder, settings Settings) {
	w.started = settings
}

func (w *recordingWorkspace) UpdateSettings(settings Settings)        { w.updated = settings }
func (w *recordingWorkspace) DidOpen(uri protocol.DocumentURI, _ int) { w.opened = uri }
func (w *recordingWorkspace) DidChange(uri protocol.DocumentURI, version int, changes []protocol.TextDocumentContentChangeEvent) {
	w.changedURI = uri
	w.changedVersion = version
	w.changes = changes
}
func (w *recordingWorkspace) DidSave(uri protocol.DocumentURI)  { w.saved = uri }
func (w *recordingWorkspace) DidClose(uri protocol.DocumentURI) { w.closed = uri }
func (w *recordingWorkspace) DisplayedFindings(protocol.DocumentURI, protocol.Position) []displayedFinding {
	return nil
}
func (w *recordingWorkspace) LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool) {
	return "", true
}
func (w *recordingWorkspace) Close() {}
