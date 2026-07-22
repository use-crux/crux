package readmodel_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestRelationOnlyHubUpdateIsAFullSnapshotRetainedByLSPStore(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	root := t.TempDir()
	version := "relation-test"
	backing := store.NewStore()
	initial := store.IndexData{Relations: []store.ProjectRelation{{
		ID: "relation:old", To: "tool:search", Source: &store.SourceLoc{File: "writer.ts", Line: 1},
	}}}
	backing.SetIndexData(initial)
	service := devtools.NewService(backing, inspect.NewService(backing, inspect.Dir(t.TempDir())))
	defer service.Shutdown()
	hub := server.NewWSHub(ctx, service, nil, nil, nil, nil, server.IndexSnapshotOptions{
		ProjectRoot: root, ServerVersion: version,
	})
	defer func() {
		closeCtx, closeCancel := context.WithTimeout(context.Background(), time.Second)
		defer closeCancel()
		if err := hub.Close(closeCtx); err != nil {
			t.Errorf("close WebSocket hub: %v", err)
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/ui", hub.HandleUpgrade)
	mux.HandleFunc("/api/index", func(w http.ResponseWriter, r *http.Request) {
		index, err := hub.ProjectIndex(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := json.NewEncoder(w).Encode(index); err != nil {
			t.Errorf("encode Project Index: %v", err)
		}
	})
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()

	observer, err := api.ConnectWSContext(ctx, httpServer.URL)
	if err != nil {
		t.Fatalf("connect observer: %v", err)
	}
	defer observer.Close()
	observerMessages := make(chan json.RawMessage, 8)
	go observer.ReadMessages(observerMessages)
	if messageType(t, nextMessage(t, observerMessages)) != "index" {
		t.Fatal("observer did not receive an initial full index snapshot")
	}

	lspStore := readmodel.NewStore()
	attached := make(chan struct{}, 1)
	managerCtx, cancelManager := context.WithCancel(ctx)
	managerDone := make(chan struct{})
	defer func() {
		cancelManager()
		waitSignal(t, managerDone, "LSP manager shutdown")
	}()
	manager := readmodel.NewManager(readmodel.ManagerOptions{
		ScopeID:       "scope",
		Root:          root,
		Version:       version,
		Transport:     readmodel.NewAttachTransport(api.New(httpServer.URL)),
		Store:         lspStore,
		ProbeBudget:   time.Second,
		InitialBudget: 2 * time.Second,
		OnModeChange: func(mode readmodel.Mode) {
			if mode == readmodel.ModeAttached {
				select {
				case attached <- struct{}{}:
				default:
				}
			}
		},
	})
	go func() {
		defer close(managerDone)
		manager.Run(managerCtx)
	}()
	waitSignal(t, attached, "LSP manager attachment")

	updated := initial
	updated.Relations = []store.ProjectRelation{{
		ID: "relation:new", To: "tool:search", Source: &store.SourceLoc{File: "writer.ts", Line: 2},
	}}
	service.IndexEvents().Publish(updated)

	message := nextMessage(t, observerMessages)
	if got := messageType(t, message); got != "index" {
		t.Fatalf("relation-only update type = %q, want full index snapshot", got)
	}
	waitForRelation(t, lspStore, "scope", "relation:new")
	cancelManager()
	waitSignal(t, managerDone, "LSP manager shutdown")
}

func nextMessage(t *testing.T, messages <-chan json.RawMessage) json.RawMessage {
	t.Helper()
	select {
	case message, ok := <-messages:
		if !ok {
			t.Fatal("WebSocket message stream closed")
		}
		return message
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for WebSocket message")
		return nil
	}
}

func messageType(t *testing.T, message json.RawMessage) string {
	t.Helper()
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(message, &envelope); err != nil {
		t.Fatalf("decode WebSocket message: %v", err)
	}
	return envelope.Type
}

func waitSignal(t *testing.T, signal <-chan struct{}, description string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for %s", description)
	}
}

func waitForRelation(t *testing.T, lspStore *readmodel.Store, scope, id string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		relations := lspStore.Relations(scope)
		if len(relations) == 1 && relations[0].ID == id {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("relations = %#v, want only %q", lspStore.Relations(scope), id)
}
