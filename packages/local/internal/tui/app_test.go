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

func TestAppTunnelMessageUpdatesWorkbench(t *testing.T) {
	app := NewApp("http://localhost:4400", nil, "", false)

	_, _ = app.Update(tunnelURLMsg{url: "https://example.ngrok.app?t=session-token"})

	if app.tunnelURL != "https://example.ngrok.app?t=session-token" {
		t.Fatalf("app tunnelURL = %q", app.tunnelURL)
	}
	if app.workbench.tunnelURL != "https://example.ngrok.app?t=session-token" {
		t.Fatalf("workbench tunnelURL = %q", app.workbench.tunnelURL)
	}
}

func TestAppIngestTokenMessageUpdatesWorkbench(t *testing.T) {
	app := NewApp("http://localhost:4400", nil, "", false)

	_, _ = app.Update(ingestTokenMsg{token: "project-token", path: ".crux/devtools/ingest-token"})

	if app.ingestToken != "project-token" {
		t.Fatalf("app ingestToken = %q", app.ingestToken)
	}
	if app.ingestTokenPath != ".crux/devtools/ingest-token" {
		t.Fatalf("app ingestTokenPath = %q", app.ingestTokenPath)
	}
	if app.workbench.ingestTokenPath != ".crux/devtools/ingest-token" {
		t.Fatalf("workbench ingestTokenPath = %q", app.workbench.ingestTokenPath)
	}
}
