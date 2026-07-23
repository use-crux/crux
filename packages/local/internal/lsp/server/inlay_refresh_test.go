package server

import (
	"context"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestInlaySettingsChangeRequestsRefreshOnlyWhenSupportedAndChanged(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"inlayHint":{"refreshSupport":true}}}
		}`),
	})

	changeInlaySetting(t, server, false)
	first := <-server.Outbound()
	if first.Method != protocol.MethodInlayHintRefresh || string(first.ID) != "1" {
		t.Fatalf("first refresh = %#v", first)
	}
	changeInlaySetting(t, server, false)
	select {
	case message := <-server.Outbound():
		t.Fatalf("idempotent setting emitted %#v", message)
	default:
	}
	changeInlaySetting(t, server, true)
	second := <-server.Outbound()
	if second.Method != protocol.MethodInlayHintRefresh || string(second.ID) != "2" {
		t.Fatalf("second refresh = %#v", second)
	}
}

func TestInlaySettingsChangeSkipsRefreshWithoutCapability(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodInitialize,
		Params:  []byte(`{"capabilities":{}}`),
	})
	changeInlaySetting(t, server, false)
	select {
	case message := <-server.Outbound():
		t.Fatalf("unsupported refresh emitted %#v", message)
	default:
	}
}

func TestInlayRefreshesAfterDisplayedPublicationChanges(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"inlayHint":{"refreshSupport":true}}}
		}`),
	})
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Debounce: 10 * time.Millisecond,
		OnPublish: server.requestEditorAnnotationsRefreshIfEnabled,
	})
	t.Cleanup(publisher.Close)

	publisher.Change(readmodel.Change{Scope: "scope"})
	select {
	case refresh := <-server.Outbound():
		t.Fatalf("refresh preceded displayed publication: %#v", refresh)
	default:
	}
	select {
	case refresh := <-server.Outbound():
		if refresh.Method != protocol.MethodInlayHintRefresh {
			t.Fatalf("published refresh = %#v", refresh)
		}
	case <-time.After(time.Second):
		t.Fatal("displayed publication did not request inlay refresh")
	}
}

func TestIncludeSuppressedRefilterRequestsInlayRefresh(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"inlayHint":{"refreshSupport":true}}}
		}`),
	})
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", OnPublish: server.requestEditorAnnotationsRefreshIfEnabled,
	})
	t.Cleanup(publisher.Close)

	publisher.UpdateFilter(mapping.FilterOptions{IncludeSuppressed: true})
	select {
	case refresh := <-server.Outbound():
		if refresh.Method != protocol.MethodInlayHintRefresh {
			t.Fatalf("refilter refresh = %#v", refresh)
		}
	default:
		t.Fatal("includeSuppressed refilter did not request inlay refresh")
	}
}

func TestInlayPublicationRefreshHonorsDisabledSetting(t *testing.T) {
	t.Parallel()

	server := New(Options{ClientRequestTimeout: time.Hour})
	t.Cleanup(server.CloseClientRequests)
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"workspace":{"inlayHint":{"refreshSupport":true}}},
			"initializationOptions":{"crux":{"inlayHints":{"enabled":false}}}
		}`),
	})
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", OnPublish: server.requestEditorAnnotationsRefreshIfEnabled,
	})
	t.Cleanup(publisher.Close)

	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	select {
	case refresh := <-server.Outbound():
		t.Fatalf("disabled publication refresh = %#v", refresh)
	default:
	}
}

func changeInlaySetting(t *testing.T, server *Server, enabled bool) {
	t.Helper()
	value := "false"
	if enabled {
		value = "true"
	}
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		Method:  protocol.MethodDidChangeConfiguration,
		Params:  []byte(`{"settings":{"crux":{"inlayHints":{"enabled":` + value + `}}}}`),
	})
}
