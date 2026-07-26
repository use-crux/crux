package server

import (
	"context"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPromptTextRefreshUsesExactExperimentalCapability(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{
				"experimental":{"crux":{"promptText":{"refreshSupport":true}}}
			}
		}`),
	})

	server.requestPromptTextRefresh()

	select {
	case refresh := <-server.Outbound():
		if refresh.Method != protocol.MethodPromptTextRefresh {
			t.Fatalf("refresh method = %q", refresh.Method)
		}
		params, ok := refresh.Params.(protocol.PromptTextRefreshParams)
		if !ok || params.ProtocolVersion != protocol.PromptTextProtocolVersion {
			t.Fatalf("refresh params = %#v", refresh.Params)
		}
	default:
		t.Fatal("exact PromptText capability did not enable refresh")
	}
}

func TestPromptTextRefreshTreatsOtherCapabilityShapesAsUnsupported(t *testing.T) {
	t.Parallel()

	capabilities := []struct {
		name string
		json string
	}{
		{name: "absent", json: `{}`},
		{name: "false", json: `{
			"experimental":{"crux":{"promptText":{"refreshSupport":false}}}
		}`},
		{name: "malformed flag", json: `{
			"experimental":{"crux":{"promptText":{"refreshSupport":"true"}}}
		}`},
		{name: "malformed experimental", json: `{"experimental":false}`},
		{name: "unrelated standard refresh", json: `{
			"workspace":{"codeLens":{"refreshSupport":true}}
		}`},
	}
	for _, capability := range capabilities {
		capability := capability
		t.Run(capability.name, func(t *testing.T) {
			t.Parallel()

			server := New(Options{ClientRequestTimeout: time.Hour})
			t.Cleanup(server.CloseClientRequests)
			result := server.Handle(context.Background(), protocol.Request{
				JSONRPC: protocol.JSONRPCVersion,
				ID:      []byte("1"),
				Method:  protocol.MethodInitialize,
				Params:  []byte(`{"capabilities":` + capability.json + `}`),
			})
			if result.Error != nil {
				t.Fatalf("initialize rejected unsupported capability: %#v", result.Error)
			}

			server.requestPromptTextRefresh()

			select {
			case refresh := <-server.Outbound():
				t.Fatalf("unsupported capability emitted %#v", refresh)
			default:
			}
		})
	}
}

func TestPromptTextRefreshTracksTransientSourceEpochAndAvailability(t *testing.T) {
	t.Parallel()

	server := newPromptTextRefreshServer(t)
	session := &scopeSession{mode: readmodel.ModeOwn}
	workspace := &workspaceRuntime{
		server: server, sessions: []*scopeSession{session},
	}
	source := &controlledCompletionSource{}

	workspace.setSessionTransientSource(session, source)
	assertPromptTextRefresh(t, server)

	workspace.invalidateTransientSource(session)
	assertPromptTextRefresh(t, server)

	workspace.setSessionMode(session, readmodel.ModeAttached)
	assertPromptTextRefresh(t, server)
}

func TestPromptTextRefreshFollowsCoherentDisplayedPublication(t *testing.T) {
	t.Parallel()

	server := newPromptTextRefreshServer(t)
	publisher := NewPublisher(PublisherOptions{
		ScopeID:   "scope",
		Debounce:  10 * time.Millisecond,
		OnPublish: server.requestEditorAnnotationsRefreshIfEnabled,
	})
	t.Cleanup(publisher.Close)

	publisher.Change(readmodel.Change{Scope: "scope"})

	select {
	case refresh := <-server.Outbound():
		if refresh.Method != protocol.MethodPromptTextRefresh {
			t.Fatalf("publication refresh = %#v", refresh)
		}
	case <-time.After(time.Second):
		t.Fatal("coherent displayed publication did not request PromptText refresh")
	}
}

func newPromptTextRefreshServer(t *testing.T) *Server {
	t.Helper()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{
				"experimental":{"crux":{"promptText":{"refreshSupport":true}}}
			}
		}`),
	})
	if result.Error != nil {
		t.Fatalf("initialize PromptText refresh server: %#v", result.Error)
	}
	return server
}

func assertPromptTextRefresh(t *testing.T, server *Server) {
	t.Helper()

	select {
	case refresh := <-server.Outbound():
		if refresh.Method != protocol.MethodPromptTextRefresh {
			t.Fatalf("refresh method = %q", refresh.Method)
		}
		params, ok := refresh.Params.(protocol.PromptTextRefreshParams)
		if !ok || params.ProtocolVersion != protocol.PromptTextProtocolVersion {
			t.Fatalf("refresh params = %#v", refresh.Params)
		}
	default:
		t.Fatal("PromptText identity change did not request refresh")
	}
}
