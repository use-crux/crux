package server

import (
	"context"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestCodeLensRefreshTracksAttachedAvailabilityChanges(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"codeLens":{"refreshSupport":true}}}
		}`),
	})
	session := &scopeSession{mode: readmodel.ModeOwn}
	workspace := &workspaceRuntime{
		server: server, settings: Settings{CodeLensEnabled: true}, sessions: []*scopeSession{session},
	}

	workspace.setSessionMode(session, readmodel.ModeAttached)
	first := <-server.Outbound()
	if first.Method != protocol.MethodCodeLensRefresh || string(first.ID) != "1" {
		t.Fatalf("attach refresh = %#v", first)
	}
	workspace.setSessionMode(session, readmodel.ModeReconnect)
	second := <-server.Outbound()
	if second.Method != protocol.MethodCodeLensRefresh || string(second.ID) != "2" {
		t.Fatalf("detach refresh = %#v", second)
	}
	workspace.setSessionMode(session, readmodel.ModeOwn)
	select {
	case message := <-server.Outbound():
		t.Fatalf("non-attached transition emitted %#v", message)
	default:
	}
}

func TestCodeLensSettingsChangeRequestsRefreshOnlyWhenSupportedAndChanged(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"codeLens":{"refreshSupport":true}}}
		}`),
	})
	changeCodeLensSetting(server, false)
	select {
	case refresh := <-server.Outbound():
		if refresh.Method != protocol.MethodCodeLensRefresh || string(refresh.ID) != "1" {
			t.Fatalf("disable refresh = %#v", refresh)
		}
	default:
		t.Fatal("code lens disable did not request refresh")
	}
	changeCodeLensSetting(server, false)
	select {
	case message := <-server.Outbound():
		t.Fatalf("idempotent setting emitted %#v", message)
	default:
	}
}

func TestCodeLensRefreshesAfterStorePublicationChanges(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"codeLens":{"refreshSupport":true}}}
		}`),
	})
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Debounce: 10 * time.Millisecond, OnPublish: server.requestCodeLensRefresh,
	})
	t.Cleanup(publisher.Close)
	session := &scopeSession{publisher: publisher}
	workspace := &workspaceRuntime{
		server: server, settings: Settings{CodeLensEnabled: true}, sessions: []*scopeSession{session},
	}
	workspace.handleScopeChange(session, readmodel.Change{Scope: "scope"})
	select {
	case refresh := <-server.Outbound():
		t.Fatalf("refresh preceded displayed publication: %#v", refresh)
	default:
	}
	select {
	case refresh := <-server.Outbound():
		if refresh.Method != protocol.MethodCodeLensRefresh {
			t.Fatalf("published refresh = %#v", refresh)
		}
	case <-time.After(time.Second):
		t.Fatal("displayed publication did not request code lens refresh")
	}
	select {
	case refresh := <-server.Outbound():
		t.Fatalf("publication emitted duplicate refresh: %#v", refresh)
	default:
	}
}

func TestCodeLensRefreshesWhenSaveRevealsHeldPublication(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"codeLens":{"refreshSupport":true}}}
		}`),
	})
	store, publisher, recorder, uri, file := newViewPublisherWithOnPublish(
		t, server.requestCodeLensRefresh,
	)
	column := 1
	definition := viewDefinition("prompt:writer", file, 3, &column, nil)
	first := viewFinding("first", file, 3)
	first.PrimaryDefinitionID = definition.ID
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition},
		Findings:    []api.IndexLintFinding{first},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.wait(t, 1)
	<-server.Outbound()
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	<-server.Outbound()
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{}, Text: "\n",
	}})
	recorder.wait(t, 3)
	second := viewFinding("second", file, 3)
	second.PrimaryDefinitionID = definition.ID
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition},
		Findings:    []api.IndexLintFinding{first, second},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	<-server.Outbound()
	beforeSave := buildCodeLenses(publisher.DefinitionSummariesIn(uri), false, 4604)
	if len(beforeSave) != 1 || beforeSave[0].Command.Title != "Crux: 1 finding" {
		t.Fatalf("dirty lenses = %#v, want held count hidden", beforeSave)
	}

	publisher.DidSave(uri)
	recorder.wait(t, 4)
	select {
	case refresh := <-server.Outbound():
		if refresh.Method != protocol.MethodCodeLensRefresh || string(refresh.ID) != "4" {
			t.Fatalf("save refresh = %#v", refresh)
		}
	default:
		t.Fatal("save did not refresh after revealing the held publication")
	}
	afterSave := buildCodeLenses(publisher.DefinitionSummariesIn(uri), false, 4604)
	if len(afterSave) != 1 || afterSave[0].Command.Title != "Crux: 2 findings" {
		t.Fatalf("saved lenses = %#v, want revealed held count", afterSave)
	}
}

func TestCodeLensPublicationRefreshHonorsDisabledSetting(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"codeLens":{"refreshSupport":true}}},
			"initializationOptions":{"crux":{"codeLens":{"enabled":false}}}
		}`),
	})
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", OnPublish: server.requestCodeLensRefreshIfEnabled,
	})
	t.Cleanup(publisher.Close)

	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	select {
	case refresh := <-server.Outbound():
		t.Fatalf("disabled publication refresh = %#v", refresh)
	default:
	}
}

func changeCodeLensSetting(server *Server, enabled bool) {
	value := "false"
	if enabled {
		value = "true"
	}
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, Method: protocol.MethodDidChangeConfiguration,
		Params: []byte(`{"settings":{"crux":{"codeLens":{"enabled":` + value + `}}}}`),
	})
}
