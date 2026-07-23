package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHTTPAndWebSocketIndexSnapshotsShareSessionMetadata(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	s := store.NewStore()
	s.SetIndex([]store.PromptMeta{{ID: "prompt:writer"}}, nil, nil)
	handler := NewHTTPServer(s, ServerOptions{
		InspectDir:    t.TempDir(),
		ProjectRoot:   root,
		ServerVersion: "0.6.0-test",
	})
	ts := httptest.NewServer(handler)
	defer ts.Close()

	response, err := ts.Client().Get(ts.URL + "/api/index")
	if err != nil {
		t.Fatalf("GET /api/index: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/index status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	var rest map[string]any
	if err := json.NewDecoder(response.Body).Decode(&rest); err != nil {
		t.Fatalf("decode /api/index: %v", err)
	}

	ws := dialWS(t, ts)
	defer ws.Close()
	websocket := readIndexEvent(t, ws)

	for key, want := range map[string]any{
		"projectRoot":   root,
		"serverVersion": "0.6.0-test",
		"generation":    float64(0),
	} {
		if got := rest[key]; got != want {
			t.Fatalf("REST %s = %#v, want %#v", key, got, want)
		}
		if got := websocket[key]; got != want {
			t.Fatalf("WebSocket %s = %#v, want %#v", key, got, want)
		}
	}
	if !jsonEqual(rest["prompts"], websocket["prompts"]) {
		t.Fatalf("REST and WebSocket prompt snapshots differ: REST=%#v WebSocket=%#v", rest["prompts"], websocket["prompts"])
	}
}

func TestWSHubProjectIndexLazilyCachesOneGeneration(t *testing.T) {
	t.Parallel()

	s := store.NewStore()
	s.SetIndex([]store.PromptMeta{{ID: "prompt:first"}}, nil, nil)
	inspectService := inspect.NewService(s, inspect.Dir(t.TempDir()))
	devtoolsService := devtools.NewService(s, inspectService)
	hub := &WSHub{
		devtools:      devtoolsService,
		projectRoot:   t.TempDir(),
		serverVersion: "0.6.0-test",
	}

	first, err := hub.ProjectIndex(context.Background())
	if err != nil {
		t.Fatalf("first hub ProjectIndex: %v", err)
	}
	s.SetIndex([]store.PromptMeta{{ID: "prompt:unpublished"}}, nil, nil)
	second, err := hub.ProjectIndex(context.Background())
	if err != nil {
		t.Fatalf("second hub ProjectIndex: %v", err)
	}

	if len(first.Prompts) != 1 || first.Prompts[0].ID != "prompt:first" {
		t.Fatalf("first prompts = %#v, want lazy devtools snapshot", first.Prompts)
	}
	if len(second.Prompts) != 1 || second.Prompts[0].ID != "prompt:first" {
		t.Fatalf("second prompts = %#v, want cached coherent snapshot", second.Prompts)
	}
	if first.Generation != 0 || second.Generation != first.Generation {
		t.Fatalf("generations = %d then %d, want one cached generation", first.Generation, second.Generation)
	}

	published := store.IndexData{Prompts: []store.PromptMeta{{ID: "prompt:published"}}}
	messages := hub.indexUpdateMessages(published)
	third, err := hub.ProjectIndex(context.Background())
	if err != nil {
		t.Fatalf("published hub ProjectIndex: %v", err)
	}
	if len(third.Prompts) != 1 || third.Prompts[0].ID != "prompt:published" || third.Generation != 1 {
		t.Fatalf("published snapshot = %#v generation %d, want prompt:published at generation 1", third.Prompts, third.Generation)
	}
	if len(messages) != 1 {
		t.Fatalf("published messages = %d, want one full snapshot", len(messages))
	}
	message, ok := messages[0].(indexSnapshotMessage)
	if !ok || message.Generation != third.Generation {
		t.Fatalf("published message = %#v, want generation %d full snapshot", messages[0], third.Generation)
	}
}

func TestWebSocketClientIsNotBroadcastVisibleBeforeIndexSnapshot(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := store.NewStore()
	inspectService := inspect.NewService(s, inspect.Dir(t.TempDir()))
	devtoolsService := devtools.NewService(s, inspectService)
	hub := NewWSHub(ctx, devtoolsService, nil, nil, nil, nil, IndexSnapshotOptions{
		ProjectRoot:   t.TempDir(),
		ServerVersion: "0.6.0-test",
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/ws/ui", hub.HandleUpgrade)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	hub.indexMu.Lock()
	locked := true
	defer func() {
		if locked {
			hub.indexMu.Unlock()
		}
	}()
	ws := dialWS(t, ts)
	defer ws.Close()
	time.Sleep(20 * time.Millisecond)
	if count := hub.ClientCount(); count != 0 {
		t.Fatalf("client count before coherent snapshot = %d, want 0", count)
	}
	hub.indexMu.Unlock()
	locked = false

	ws.SetReadDeadline(time.Now().Add(time.Second))
	_, payload, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read initial snapshot: %v", err)
	}
	var message map[string]any
	if err := json.Unmarshal(payload, &message); err != nil {
		t.Fatalf("decode initial snapshot: %v", err)
	}
	if message["type"] != "index" {
		t.Fatalf("first message type = %#v, want index snapshot", message["type"])
	}
}

func jsonEqual(left any, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}
