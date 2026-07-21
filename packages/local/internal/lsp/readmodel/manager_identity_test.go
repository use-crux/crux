package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestManagerRejectsWebSocketSnapshotForAnotherProject(t *testing.T) {
	root := t.TempDir()
	otherRoot := t.TempDir()
	file := root + "/writer.ts"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write(snapshotJSON(root, file, "probe", 1))
	}))
	defer server.Close()

	var wrongSnapshotApplied atomic.Bool
	connectCount := atomic.Int32{}
	store := NewStore()
	manager := NewManager(ManagerOptions{
		ScopeID: root, Root: root, Version: "v-test",
		Transport: NewAttachTransport(api.New(server.URL)), Store: store, Logs: io.Discard,
		InitialBudget: 50 * time.Millisecond, Grace: 10 * time.Millisecond,
		Backoffs: []time.Duration{time.Millisecond},
		Connect: func(context.Context, string) (MessageStream, error) {
			if connectCount.Add(1) > 1 {
				return nil, errors.New("unavailable")
			}
			closed := make(chan struct{})
			close(closed)
			return newScriptedStream(
				[]json.RawMessage{snapshotJSON(otherRoot, file, "wrong", 1)},
				closed,
			), nil
		},
		StartOwn: func(context.Context, OwnOptions) (OwnSource, error) {
			return newFakeOwnSource(Snapshot{}), nil
		},
		OnChange: func(Change) {
			if findingIDsEqual(store.Findings(root, file), "wrong") {
				wrongSnapshotApplied.Store(true)
			}
		},
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); manager.Run(ctx) }()
	waitFor(t, time.Second, func() bool { return manager.Mode() == ModeOwn })
	if wrongSnapshotApplied.Load() {
		t.Fatal("WebSocket snapshot for another project was applied")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("manager did not stop")
	}
}

func TestManagerImmediateReconnectClosuresExpireOriginalGrace(t *testing.T) {
	root := t.TempDir()
	file := root + "/writer.ts"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write(snapshotJSON(root, file, "finding", 1))
	}))
	defer server.Close()

	var connects atomic.Int32
	manager := NewManager(ManagerOptions{
		ScopeID: root, Root: root, Version: "v-test",
		Transport: NewAttachTransport(api.New(server.URL)), Logs: io.Discard,
		Grace: 20 * time.Millisecond, Backoffs: []time.Duration{time.Millisecond},
		Connect: func(context.Context, string) (MessageStream, error) {
			connects.Add(1)
			closed := make(chan struct{})
			close(closed)
			return newScriptedStream(
				[]json.RawMessage{snapshotJSON(root, file, "finding", 1)},
				closed,
			), nil
		},
		StartOwn: func(context.Context, OwnOptions) (OwnSource, error) {
			return newFakeOwnSource(Snapshot{}), nil
		},
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); manager.Run(ctx) }()
	waitFor(t, 250*time.Millisecond, func() bool { return manager.Mode() == ModeOwn })
	if got := connects.Load(); got < 2 || got > 30 {
		t.Fatalf("connect attempts = %d, want bounded retries within one grace window", got)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("manager did not stop")
	}
}

func TestManagerRejectsReconnectResyncForAnotherProject(t *testing.T) {
	root := t.TempDir()
	otherRoot := t.TempDir()
	file := root + "/writer.ts"
	var serveOther atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if serveOther.Load() {
			_, _ = response.Write(snapshotJSON(otherRoot, file, "wrong", 2))
			return
		}
		_, _ = response.Write(snapshotJSON(root, file, "old", 1))
	}))
	defer server.Close()

	firstDrop := make(chan struct{})
	var connects atomic.Int32
	store := NewStore()
	var wrongSnapshotApplied atomic.Bool
	manager := NewManager(ManagerOptions{
		ScopeID: root, Root: root, Version: "v-test",
		Transport: NewAttachTransport(api.New(server.URL)), Store: store, Logs: io.Discard,
		Grace: 20 * time.Millisecond, Backoffs: []time.Duration{time.Millisecond},
		Connect: func(context.Context, string) (MessageStream, error) {
			if connects.Add(1) == 1 {
				return newScriptedStream(
					[]json.RawMessage{snapshotJSON(root, file, "old", 1)},
					firstDrop,
				), nil
			}
			return newScriptedStream(nil, nil), nil
		},
		StartOwn: func(context.Context, OwnOptions) (OwnSource, error) {
			return newFakeOwnSource(Snapshot{}), nil
		},
		OnChange: func(Change) {
			if findingIDsEqual(store.Findings(root, file), "wrong") {
				wrongSnapshotApplied.Store(true)
			}
		},
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); manager.Run(ctx) }()
	waitFor(t, time.Second, func() bool { return manager.Mode() == ModeAttached })
	serveOther.Store(true)
	close(firstDrop)
	waitFor(t, time.Second, func() bool { return manager.Mode() == ModeOwn })
	if wrongSnapshotApplied.Load() {
		t.Fatal("reconnect resync for another project was applied")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("manager did not stop")
	}
}

func TestManagerKeepsOwnSourceWhenHandoverSnapshotIsForAnotherProject(t *testing.T) {
	root := t.TempDir()
	otherRoot := t.TempDir()
	file := root + "/writer.ts"
	var devAvailable atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if !devAvailable.Load() {
			http.Error(response, "unavailable", http.StatusServiceUnavailable)
			return
		}
		_, _ = response.Write(snapshotJSON(root, file, "probe", 1))
	}))
	defer server.Close()

	own := newFakeOwnSource(Snapshot{Findings: []api.IndexLintFinding{finding("own", file)}})
	var connects atomic.Int32
	manager := NewManager(ManagerOptions{
		ScopeID: root, Root: root, Version: "v-test",
		Transport: NewAttachTransport(api.New(server.URL)), Logs: io.Discard,
		Reprobe: 2 * time.Millisecond, InitialBudget: 20 * time.Millisecond,
		Connect: func(context.Context, string) (MessageStream, error) {
			connects.Add(1)
			closed := make(chan struct{})
			close(closed)
			return newScriptedStream(
				[]json.RawMessage{snapshotJSON(otherRoot, file, "wrong", 1)},
				closed,
			), nil
		},
		StartOwn: func(context.Context, OwnOptions) (OwnSource, error) { return own, nil },
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); manager.Run(ctx) }()
	waitFor(t, time.Second, func() bool { return manager.Mode() == ModeOwn })
	devAvailable.Store(true)
	waitFor(t, time.Second, func() bool { return connects.Load() > 0 })
	time.Sleep(10 * time.Millisecond)
	if manager.Mode() != ModeOwn || own.isClosed() {
		t.Fatalf("invalid handover stopped own source: mode=%s closed=%v", manager.Mode(), own.isClosed())
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("manager did not stop")
	}
}
