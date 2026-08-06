package tui

import (
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type programFixtureClient struct {
	*uitest.FixtureClient
}

func TestAppRoutesQIntoRunsFilterBeforeWorkspaceQuit(t *testing.T) {
	app := newTestApp("http://localhost:4400", programFixtureClient{uitest.NewFixtureClient()}, "", false)
	app.MarkBootComplete()

	final, output, err := runTestProgram(t, app, "3/q\rq")
	if err != nil {
		t.Fatalf("run app: %v", err)
	}
	if final != app {
		t.Fatalf("final model = %T, want original *App", final)
	}
	if !strings.Contains(output, "/q") {
		t.Fatalf("Runs filter did not receive q before workspace quit:\n%s", output)
	}
	if !app.quitRequested {
		t.Fatal("workspace q did not request a clean quit")
	}
}

func TestInputCoalescerFlushesIndexMovementBeforeNextAction(t *testing.T) {
	app := newShutdownTestApp(t.Context())
	app.workbench.activeNav = "index"
	coalescer := NewInputCoalescer(nil)
	for range 30 {
		if got := coalescer.Filter(app, tea.KeyPressMsg{Text: "j", Code: 'j'}); got != nil {
			t.Fatalf("buffered movement passed through as %#v", got)
		}
	}
	got := coalescer.Filter(app, tea.KeyPressMsg{Text: "1", Code: '1'})
	burst, ok := got.(movementBurstMsg)
	if !ok || len(burst.keys) != 30 {
		t.Fatalf("flush = %#v, want 30-key movement burst", got)
	}
	if next, ok := burst.next.(tea.KeyPressMsg); !ok || next.String() != "1" {
		t.Fatalf("flush next = %#v, want screen key 1", burst.next)
	}
}

func TestInputCoalescerLetsQuitPreemptBufferedMovement(t *testing.T) {
	app := newShutdownTestApp(t.Context())
	app.workbench.activeNav = "index"
	coalescer := NewInputCoalescer(nil)
	for range 60 {
		coalescer.Filter(app, tea.KeyPressMsg{Text: "j", Code: 'j'})
	}
	quit := tea.KeyPressMsg{Text: "q", Code: 'q'}
	got, ok := coalescer.Filter(app, quit).(tea.KeyPressMsg)
	if !ok || got.String() != "q" {
		t.Fatalf("quit became %#v, want direct KeyPressMsg", got)
	}
	coalescer.mu.Lock()
	defer coalescer.mu.Unlock()
	if len(coalescer.keys) != 0 {
		t.Fatal("quit retained buffered movement")
	}
}

func TestInputCoalescerFlushesMovementAfterQuietPeriod(t *testing.T) {
	app := newShutdownTestApp(t.Context())
	app.workbench.activeNav = "index"
	sent := make(chan tea.Msg, 1)
	coalescer := NewInputCoalescer(func(msg tea.Msg) { sent <- msg })
	for range 30 {
		coalescer.Filter(app, tea.KeyPressMsg{Text: "j", Code: 'j'})
	}

	select {
	case got := <-sent:
		burst, ok := got.(movementBurstMsg)
		if !ok || len(burst.keys) != 30 || burst.next != nil {
			t.Fatalf("quiet flush = %#v, want 30-key terminal burst", got)
		}
	case <-time.After(time.Second):
		t.Fatal("buffered movement did not flush after the quiet period")
	}
}

func TestInputCoalescerBoundsContinuousMovementBursts(t *testing.T) {
	app := newShutdownTestApp(t.Context())
	app.workbench.activeNav = "index"
	coalescer := NewInputCoalescer(nil)
	for index := range maxMovementBurstKeys - 1 {
		if got := coalescer.Filter(app, tea.KeyPressMsg{Text: "j", Code: 'j'}); got != nil {
			t.Fatalf("movement %d flushed early as %#v", index, got)
		}
	}
	got := coalescer.Filter(app, tea.KeyPressMsg{Text: "j", Code: 'j'})
	burst, ok := got.(movementBurstMsg)
	if !ok || len(burst.keys) != maxMovementBurstKeys {
		t.Fatalf("bounded flush = %#v, want %d keys", got, maxMovementBurstKeys)
	}
}

func TestInputCoalescerPreservesOlderTimedBurstBeforeNewerKeys(t *testing.T) {
	app := newShutdownTestApp(t.Context())
	app.workbench.activeNav = "index"
	coalescer := NewInputCoalescer(nil)
	coalescer.Filter(app, tea.KeyPressMsg{Text: "k", Code: 'k'})
	older := movementBurstMsg{keys: []tea.KeyPressMsg{{Text: "j", Code: 'j'}}}
	if got := coalescer.Filter(app, older); len(got.(movementBurstMsg).keys) != 1 || got.(movementBurstMsg).keys[0].String() != "j" {
		t.Fatalf("older burst reordered as %#v", got)
	}
	coalescer.mu.Lock()
	defer coalescer.mu.Unlock()
	if coalescer.timer != nil {
		coalescer.timer.Stop()
		coalescer.timer = nil
	}
	if len(coalescer.keys) != 1 || coalescer.keys[0].String() != "k" {
		t.Fatalf("newer buffered keys = %#v, want k retained", coalescer.keys)
	}
}

func TestInputCoalescerLetsRootShutdownPreemptBufferedMovement(t *testing.T) {
	app := newShutdownTestApp(t.Context())
	app.workbench.activeNav = "index"
	coalescer := NewInputCoalescer(nil)
	coalescer.Filter(app, tea.KeyPressMsg{Text: "j", Code: 'j'})
	request := shutdownRequestMsg{cause: ShutdownContextCanceled}
	if got := coalescer.Filter(app, request); got != request {
		t.Fatalf("root shutdown became %#v, want direct request", got)
	}
	coalescer.mu.Lock()
	defer coalescer.mu.Unlock()
	if len(coalescer.keys) != 0 {
		t.Fatalf("root shutdown retained %d movement keys", len(coalescer.keys))
	}
}

func TestAppDispatchesWrappedRootShutdownAtApplicationBoundary(t *testing.T) {
	app := newShutdownTestApp(t.Context())
	app.workbench.activeNav = "index"
	_, command := app.Update(movementBurstMsg{
		keys: []tea.KeyPressMsg{{Text: "j", Code: 'j'}},
		next: shutdownRequestMsg{cause: ShutdownContextCanceled},
	})
	if !app.shutdownStarted.Load() || command == nil {
		t.Fatal("wrapped root shutdown did not reach the application quit path")
	}
	if got := app.ShutdownResult().Cause; got != ShutdownContextCanceled {
		t.Fatalf("wrapped shutdown cause = %v, want context canceled", got)
	}
}
