package readmodel

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	localserver "github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestManagerReconnectKeepsStaleStoreUntilHTTPResync(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "writer.ts")
	var responseMu sync.RWMutex
	responseID := "old"
	httpServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		responseMu.RLock()
		id := responseID
		responseMu.RUnlock()
		_, _ = response.Write(snapshotJSON(root, file, id, 1))
	}))
	defer httpServer.Close()

	firstDropped := make(chan struct{})
	first := newScriptedStream(
		[]json.RawMessage{snapshotJSON(root, file, "old", 1)},
		firstDropped,
	)
	second := newScriptedStream(
		[]json.RawMessage{snapshotJSON(root, file, "stale-ws", 1)},
		nil,
	)
	var connectMu sync.Mutex
	connectCount := 0
	connect := func(context.Context, string) (MessageStream, error) {
		connectMu.Lock()
		defer connectMu.Unlock()
		connectCount++
		if connectCount == 1 {
			return first, nil
		}
		return second, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	findings := NewStore()
	manager := NewManager(ManagerOptions{
		ScopeID:   root,
		Root:      root,
		Version:   "v-test",
		Transport: NewAttachTransport(api.New(httpServer.URL)),
		Store:     findings,
		Logs:      io.Discard,
		Grace:     100 * time.Millisecond,
		Backoffs:  []time.Duration{time.Millisecond},
		Connect:   connect,
	})
	done := make(chan struct{})
	go func() { defer close(done); manager.Run(ctx) }()
	waitFor(t, time.Second, func() bool { return findingIDsEqual(findings.Findings(root, file), "old") })

	responseMu.Lock()
	responseID = "resynced"
	responseMu.Unlock()
	close(firstDropped)
	if !findingIDsEqual(findings.Findings(root, file), "old") {
		t.Fatal("store cleared immediately on disconnect")
	}
	waitFor(t, time.Second, func() bool {
		return manager.Mode() == ModeAttached && findingIDsEqual(findings.Findings(root, file), "resynced")
	})
	time.Sleep(10 * time.Millisecond)
	if !findingIDsEqual(findings.Findings(root, file), "resynced") {
		t.Fatal("reconnect initial WS snapshot regressed the HTTP resync")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("manager did not stop after cancellation")
	}
}

func TestManagerAttachesToRealHubAndResyncsGenerationGap(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "writer.ts")
	indexStore := store.NewStore()
	indexStore.SetIndexData(indexWithFinding("old", file))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handler := localserver.NewHTTPServer(indexStore, localserver.ServerOptions{
		ProjectRoot:   root,
		ServerVersion: "v-test",
		InspectDir:    t.TempDir(),
	})
	httpServer := httptest.NewServer(handler)
	defer httpServer.Close()

	findings := NewStore()
	manager := NewManager(ManagerOptions{
		ScopeID:   root,
		Root:      root,
		Version:   "v-test",
		Transport: NewAttachTransport(api.New(httpServer.URL)),
		Store:     findings,
		Logs:      io.Discard,
	})
	done := make(chan struct{})
	go func() {
		defer close(done)
		manager.Run(ctx)
	}()

	waitFor(t, time.Second, func() bool {
		return manager.Mode() == ModeAttached && findingIDsEqual(findings.Findings(root, file), "old")
	})

	// An equal publication advances the hub generation without a message. The
	// following changed delta therefore has a gap and must be recovered by HTTP.
	indexStore.SetIndexData(indexWithFinding("old", file))
	time.Sleep(30 * time.Millisecond)
	indexStore.SetIndexData(indexWithFinding("new", file))
	waitFor(t, time.Second, func() bool {
		return findingIDsEqual(findings.Findings(root, file), "new")
	})

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("manager did not stop after cancellation")
	}
}

func indexWithFinding(id, file string) store.IndexData {
	return store.IndexData{LintFindings: []store.IndexLintFinding{{
		ID:       id,
		RuleID:   "test.rule",
		Profiles: []string{"recommended"},
		Source:   &store.SourceLoc{File: file, Line: 1},
	}}}
}

func findingIDsEqual(findings []api.IndexLintFinding, ids ...string) bool {
	if len(findings) != len(ids) {
		return false
	}
	for index, id := range ids {
		if findings[index].ID != id {
			return false
		}
	}
	return true
}

func waitFor(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition was not met before timeout")
}

func snapshotJSON(root, file, id string, generation uint64) json.RawMessage {
	encoded, _ := json.Marshal(map[string]any{
		"type":          "index",
		"projectRoot":   root,
		"serverVersion": "v-test",
		"generation":    generation,
		"prompts":       []any{},
		"contexts":      []any{},
		"tools":         []any{},
		"lintFindings": []any{map[string]any{
			"id": id, "ruleId": "test.rule", "source": map[string]any{"file": file, "line": 1},
		}},
	})
	return encoded
}

type scriptedStream struct {
	messages []json.RawMessage
	drop     <-chan struct{}
	closed   chan struct{}
	once     sync.Once
}

func newScriptedStream(messages []json.RawMessage, drop <-chan struct{}) *scriptedStream {
	return &scriptedStream{messages: messages, drop: drop, closed: make(chan struct{})}
}

func (s *scriptedStream) ReadMessages(output chan<- json.RawMessage) {
	defer close(output)
	for _, message := range s.messages {
		select {
		case output <- message:
		case <-s.closed:
			return
		}
	}
	if s.drop == nil {
		<-s.closed
		return
	}
	select {
	case <-s.drop:
	case <-s.closed:
	}
}

func (s *scriptedStream) Close() {
	s.once.Do(func() { close(s.closed) })
}
