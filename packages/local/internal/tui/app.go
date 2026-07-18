// Package tui provides the interactive terminal dashboard using Bubbletea.
//
// Post-boot the TUI is the V1 Panels Inspect Workbench, implemented in
// workbench.go + the shell/screens/components subpackages. This file just
// owns the boot phase and the program plumbing dev.go uses to inject events.
package tui

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

// DataClient is the typed in-process surface used by the TUI. It is
// satisfied by `internal/devtools.DirectClient` (see direct_client_typed.go).
//
// Screens depend on the narrower `screens.DataClient` interface (a subset of
// this one) so they remain independently testable.
type DataClient interface {
	screens.DataClient

	// Legacy raw access — used only by the boot phase and any future
	// non-Inspect screens (e.g. the "traces" tab body).
	GetJSON(ctx context.Context, path string, target any) error
}

// App is the root Bubbletea model. It owns boot lifecycle + the workbench.
type App struct {
	client    DataClient
	serverURL string

	width  int
	height int

	spinner   spinner.Model
	ready     bool
	program   *tea.Program
	programMu sync.RWMutex
	workbench *Workbench

	pendingMsgs        chan tea.Msg
	programStarted     chan struct{}
	programStartedOnce sync.Once

	// Boot.
	bootPhase    string
	bootLogs     []string
	bootError    string
	bootComplete bool

	tunnelURL       string
	ingestToken     string
	ingestTokenPath string

	startupMode    string
	startupDebug   bool
	startupSummary string

	// Callbacks.
	onInitialDataLoaded func()
	onDashboardVisible  func()
	onQuitRequested     func()
	initialDataNotified bool
	dashboardNotified   bool
	quitRequested       bool
}

// --- External API (called from dev.go) ---

func (a *App) SetInitialDataLoadedCallback(fn func()) { a.onInitialDataLoaded = fn }
func (a *App) SetDashboardVisibleCallback(fn func())  { a.onDashboardVisible = fn }
func (a *App) SetQuitRequestedCallback(fn func())     { a.onQuitRequested = fn }

// SendStoreChanged injects a local store change into the TUI event loop.
// Triggers the active screen to re-fetch.
func (a *App) SendStoreChanged() { a.sendMsg(storeChangedMsg{}) }

// SendInspectEvent forwards a typed Inspect event into the TUI event loop.
// Used by `runTUI` to bridge Inspect subscriptions into Bubble Tea
// without a JSON roundtrip.
func (a *App) SendInspectEvent(ev api.InspectEvent) { a.sendMsg(inspectEventMsg(ev)) }

// SendMsg injects an already-typed Bubble Tea message into the TUI event loop.
// It is the bridge entrypoint for batched, revision-tagged live updates.
func (a *App) SendMsg(msg tea.Msg) { a.sendMsg(msg) }

func (a *App) SendBootPhase(phase string)       { a.sendMsg(bootPhaseMsg{phase: phase}) }
func (a *App) SendBootLog(stream, text string)  { a.sendMsg(bootLogMsg{stream: stream, text: text}) }
func (a *App) SendLiveReady()                   { a.sendMsg(liveReadyMsg{}) }
func (a *App) SetStartupSummary(summary string) { a.sendMsg(startupSummaryMsg{summary: summary}) }
func (a *App) SendTunnelURL(url string)         { a.sendMsg(tunnelURLMsg{url: url}) }
func (a *App) SendIngestToken(token, path string) {
	a.sendMsg(ingestTokenMsg{token: token, path: path})
}

func (a *App) MarkBootComplete() {
	a.bootComplete = true
}

func (a *App) SendBootError(err error) {
	if err == nil {
		return
	}
	a.sendMsg(bootErrorMsg{err: err.Error()})
}

func (a *App) sendMsg(msg tea.Msg) {
	a.programMu.RLock()
	p := a.program
	a.programMu.RUnlock()
	if p != nil {
		select {
		case <-a.programStarted:
			p.Send(msg)
			return
		default:
		}
	}
	select {
	case a.pendingMsgs <- msg:
	default:
	}
}

func (a *App) SetProgram(p *tea.Program) {
	a.programMu.Lock()
	a.program = p
	a.programMu.Unlock()
	go func() {
		<-a.programStarted
		for {
			select {
			case msg := <-a.pendingMsgs:
				p.Send(msg)
			default:
				return
			}
		}
	}()
}

// --- Tea lifecycle ---

func (a *App) Init() tea.Cmd {
	a.programStartedOnce.Do(func() {
		close(a.programStarted)
	})
	if a.bootComplete {
		return tea.Batch(a.spinner.Tick, a.workbench.Init())
	}
	return a.spinner.Tick
}

func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch m := msg.(type) {
	case tea.WindowSizeMsg:
		a.width = m.Width
		a.height = m.Height
		a.ready = true
		a.workbench.Resize(a.width, a.height)
		a.maybeNotifyDashboardVisible()
		return a, nil

	case tea.KeyPressMsg:
		if !a.bootComplete || a.bootError != "" {
			switch m.String() {
			case "q", "ctrl+c":
				a.requestQuit()
				return a, tea.Quit
			}
			return a, nil
		}
		if m.String() == "ctrl+c" {
			a.requestQuit()
			return a, tea.Quit
		}
		return a, a.workbench.Update(m)

	case spinner.TickMsg:
		var cmd tea.Cmd
		a.spinner, cmd = a.spinner.Update(m)
		return a, cmd

	case bootPhaseMsg:
		a.bootPhase = m.phase

	case bootLogMsg:
		line := strings.TrimSpace(m.text)
		if line == "" {
			break
		}
		if m.stream != "" {
			line = fmt.Sprintf("[%s] %s", m.stream, line)
		}
		a.bootLogs = append(a.bootLogs, line)
		if len(a.bootLogs) > 6 {
			a.bootLogs = a.bootLogs[len(a.bootLogs)-6:]
		}

	case bootErrorMsg:
		a.bootError = m.err

	case startupSummaryMsg:
		a.startupSummary = m.summary

	case tunnelURLMsg:
		a.tunnelURL = m.url
		a.workbench.SetTunnelURL(m.url)

	case ingestTokenMsg:
		a.ingestToken = m.token
		a.ingestTokenPath = m.path
		a.workbench.SetIngestToken(m.token, m.path)

	case liveReadyMsg:
		// Boot is already marked complete before runTUI hands off; this just
		// kicks off the first round of fetches.
		a.bootComplete = true
		return a, a.workbench.Init()

	case storeChangedMsg:
		return a, a.workbench.Update(m)

	default:
		// Route any unrecognized message to the workbench so screens can
		// receive their own typed fetch-result messages.
		return a, a.workbench.Update(m)
	}

	return a, nil
}

func (a *App) View() tea.View {
	content := a.viewContent()
	view := tea.NewView(content)
	view.AltScreen = true
	return view
}

func (a *App) viewContent() string {
	if !a.ready {
		return fmt.Sprintf("\n  %s Loading...\n", a.spinner.View())
	}
	if a.bootError != "" {
		return a.viewBootError()
	}
	if !a.bootComplete {
		return a.viewBoot()
	}
	return a.workbench.View()
}

// --- State helpers ---

func (a *App) requestQuit() {
	if a.quitRequested {
		return
	}
	a.quitRequested = true
	if a.onQuitRequested != nil {
		go a.onQuitRequested()
	}
}

func (a *App) maybeNotifyDashboardVisible() {
	if a.dashboardNotified || !a.ready || !a.bootComplete {
		return
	}
	a.dashboardNotified = true
	if !a.initialDataNotified && a.onInitialDataLoaded != nil {
		a.initialDataNotified = true
		a.onInitialDataLoaded()
	}
	if a.onDashboardVisible != nil {
		a.onDashboardVisible()
	}
}
