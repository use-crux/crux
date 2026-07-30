package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestManagerOwnAttachReconnectOwnWithoutEmptyView(t *testing.T) {
	root := t.TempDir()
	file := root + "/writer.ts"
	var devAvailable atomic.Bool
	httpServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		if !devAvailable.Load() {
			http.Error(response, "not running", http.StatusServiceUnavailable)
			return
		}
		_, _ = response.Write(snapshotJSON(root, file, "same", 1))
	}))
	defer httpServer.Close()

	dropAttached := make(chan struct{})
	var connectCount atomic.Int32
	connect := func(context.Context, string) (MessageStream, error) {
		if !devAvailable.Load() || connectCount.Add(1) > 1 {
			return nil, errors.New("dev server unavailable")
		}
		return newScriptedStream([]json.RawMessage{snapshotJSON(root, file, "same", 1)}, dropAttached), nil
	}

	var ownMu sync.Mutex
	var ownSources []*fakeOwnSource
	startOwn := func(context.Context, OwnOptions) (OwnSource, error) {
		source := newFakeOwnSource(Snapshot{Findings: []api.IndexLintFinding{
			finding("same", file),
		}})
		ownMu.Lock()
		ownSources = append(ownSources, source)
		ownMu.Unlock()
		return source, nil
	}

	store := NewStore()
	transport := NewAttachTransport(api.New(httpServer.URL))
	var modeMu sync.Mutex
	var modes []Mode
	var completionMu sync.Mutex
	var completionSources []TransientSource
	modeChanges := make(chan Mode, 16)
	emptyPublish := atomic.Bool{}
	manager := NewManager(ManagerOptions{
		ScopeID: root, Root: root, Version: "v-test",
		Transport: transport, Store: store, Logs: io.Discard,
		Connect: connect, StartOwn: startOwn, Reprobe: 2 * time.Millisecond,
		Grace: 20 * time.Millisecond, Backoffs: []time.Duration{time.Millisecond},
		OnModeChange: func(mode Mode) {
			modeMu.Lock()
			modes = append(modes, mode)
			modeMu.Unlock()
			modeChanges <- mode
		},
		OnTransientSource: func(source TransientSource) {
			completionMu.Lock()
			completionSources = append(completionSources, source)
			completionMu.Unlock()
		},
		OnChange: func(Change) {
			if len(store.Findings(root, file)) == 0 {
				emptyPublish.Store(true)
			}
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); manager.Run(ctx) }()
	waitFor(t, time.Second, func() bool {
		return manager.Mode() == ModeOwn && findingIDsEqual(store.Findings(root, file), "same")
	})

	devAvailable.Store(true)
	waitFor(t, time.Second, func() bool {
		completionMu.Lock()
		defer completionMu.Unlock()
		return manager.Mode() == ModeAttached && len(completionSources) > 0 && completionSources[len(completionSources)-1] == transport
	})
	ownMu.Lock()
	firstOwnClosed := len(ownSources) > 0 && ownSources[0].isClosed()
	ownMu.Unlock()
	if !firstOwnClosed {
		t.Fatal("own watcher was not stopped after attached snapshot arrived")
	}

	devAvailable.Store(false)
	close(dropAttached)
	waitForModeCallbacks(t, modeChanges, ModeReconnect, ModeOwn)
	waitFor(t, time.Second, func() bool {
		completionMu.Lock()
		defer completionMu.Unlock()
		return len(completionSources) > 0 && completionSources[len(completionSources)-1] == nil
	})
	if len(store.Findings(root, file)) != 1 {
		t.Fatalf("own handover findings = %#v, want retained non-empty view", store.Findings(root, file))
	}
	if emptyPublish.Load() {
		t.Fatal("handover emitted a changed event with an empty finding view")
	}
	modeMu.Lock()
	gotModes := append([]Mode(nil), modes...)
	modeMu.Unlock()
	if !containsModesInOrder(gotModes, ModeDiscovering, ModeOwn, ModeAttached, ModeReconnect, ModeOwn) {
		t.Fatalf("mode sequence = %v", gotModes)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("manager did not stop after cancellation")
	}
}

type fakeOwnSource struct {
	snapshots chan Snapshot
	closed    chan struct{}
	once      sync.Once
}

func newFakeOwnSource(initial Snapshot) *fakeOwnSource {
	source := &fakeOwnSource{snapshots: make(chan Snapshot, 1), closed: make(chan struct{})}
	source.snapshots <- initial
	return source
}

func (s *fakeOwnSource) Snapshots() <-chan Snapshot { return s.snapshots }
func (s *fakeOwnSource) Close() {
	s.once.Do(func() { close(s.closed) })
}
func (s *fakeOwnSource) isClosed() bool {
	select {
	case <-s.closed:
		return true
	default:
		return false
	}
}

func containsModesInOrder(values []Mode, wanted ...Mode) bool {
	index := 0
	for _, value := range values {
		if index < len(wanted) && value == wanted[index] {
			index++
		}
	}
	return index == len(wanted)
}

func waitForModeCallbacks(t *testing.T, changes <-chan Mode, wanted ...Mode) {
	t.Helper()
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	index := 0
	for index < len(wanted) {
		select {
		case mode := <-changes:
			if mode == wanted[index] {
				index++
			}
		case <-deadline.C:
			t.Fatalf("timed out waiting for mode callbacks %v at index %d", wanted, index)
		}
	}
}
