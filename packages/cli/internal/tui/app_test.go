package tui

import (
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func TestAppQueuesExternalMessagesUntilProgramInit(t *testing.T) {
	app := NewApp("http://localhost:4400", nil, "", false)
	p := tea.NewProgram(app)
	app.SetProgram(p)

	done := make(chan struct{})
	go func() {
		app.SendTunnelURL("https://example.test")
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("external TUI message blocked before Bubble Tea program started")
	}

	select {
	case msg := <-app.pendingMsgs:
		if _, ok := msg.(tunnelURLMsg); !ok {
			t.Fatalf("queued message type = %T, want tunnelURLMsg", msg)
		}
	default:
		t.Fatal("external message was not queued before program start")
	}
}
