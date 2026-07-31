package tui

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/overlays"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

// Workbench is the post-boot V1 Panels root model. It owns the nav rail,
// status bar, breadcrumb, and the active Inspect screen. The four-section
// tab strip was dropped in S2 — the workbench IS the Inspect workbench;
// there is no second-level navigation above the nav rail.
type Workbench struct {
	ctx               context.Context
	client            screens.DataClient
	rawClient         DataClient // legacy/shared helpers
	capabilities      Capabilities
	serverURL         string
	tunnelURL         string
	ingestTokenPath   string
	browserURL        string
	openBrowser       BrowserOpener
	statusToast       string
	startupStatus     string
	startupDiagnostic *startup.Diagnostic

	width  int
	height int

	activeNav         string
	activeTarget      NavTarget
	screens           map[string]screens.Screen
	counts            map[string]int
	legacyStale       map[string]bridge.Domains
	legacyInitialized map[string]bool
	invalidated       map[string]bridge.Invalidations
	history           []Location
	devContext        api.DevtoolsContext

	pendingPrefix string // for `g…` two-key sequences

	// selection is the cross-screen record store keyed by Kind. Per the
	// approved 2026-07-16 TUI stabilization design, read/write via
	// GetSelection / SetSelection /
	// ClearSelection — screens never touch the map directly.
	selection map[Kind]string

	palette           *overlays.Palette
	help              *overlays.Help
	inspect           *overlays.Inspect
	definitionChooser *definitionChooser

	requestShutdown func() tea.Cmd
}

// NewWorkbench constructs the workbench root. All asynchronous work started by
// the workbench descends from ctx.
func NewWorkbench(ctx context.Context, client screens.DataClient, rawClient DataClient, serverURL string) *Workbench {
	w := &Workbench{
		ctx:               ctx,
		client:            client,
		rawClient:         rawClient,
		capabilities:      discoverCapabilities(client),
		serverURL:         serverURL,
		activeNav:         "overview",
		activeTarget:      NavTarget{NavID: "overview"},
		counts:            map[string]int{},
		legacyStale:       map[string]bridge.Domains{},
		legacyInitialized: map[string]bool{},
		invalidated:       map[string]bridge.Invalidations{},
		palette:           overlays.NewPalette(),
		help:              overlays.NewHelp(),
		inspect:           overlays.NewInspect(),
		definitionChooser: newDefinitionChooser(),
	}
	w.screens = map[string]screens.Screen{
		"overview": screens.NewOverview(),
		"insights": screens.NewInsights(),
		"runs":     screens.NewRuns(),
		"evals":    screens.NewEvals(),
		"index":    screens.NewIndex(),
	}
	return w
}

func (w *Workbench) setShutdownRequest(fn func() tea.Cmd) {
	w.requestShutdown = fn
}

// SetTunnelURL updates the public devtools URL once the async tunnel is ready.
func (w *Workbench) SetTunnelURL(url string) {
	w.tunnelURL = url
}

// SetIngestToken records where users can find the scoped remote-ingest token.
// The token secret itself is intentionally kept out of the persistent chrome.
func (w *Workbench) SetIngestToken(_ string, path string) {
	w.ingestTokenPath = path
}

// SetStartupSnapshot projects asynchronous initialization state into the
// persistent workbench status line.
func (w *Workbench) SetStartupSnapshot(snapshot startup.Snapshot) {
	if len(snapshot.Diagnostics) > 0 {
		diagnostic := snapshot.Diagnostics[0]
		w.startupDiagnostic = &diagnostic
		w.startupStatus = ""
		return
	}
	w.startupDiagnostic = nil
	if snapshot.Active && snapshot.Phase != "" {
		w.startupStatus = kit.SanitizeInline("starting · " + snapshot.Phase)
		return
	}
	w.startupStatus = ""
}

// Init is called once to fire initial fetches for the active screen and the
// devtools context.
func (w *Workbench) Init() tea.Cmd {
	w.resizeActiveScreen()
	if _, legacy := w.activeScreen().(screens.LegacyInvalidationScreen); legacy {
		w.legacyInitialized[w.activeNav] = true
	}
	return tea.Batch(
		w.fetchContext(),
		w.activeScreen().Init(w.ctx, w.client),
	)
}

// Update routes a tea.Msg through the active screen and handles global keys.
func (w *Workbench) Update(msg tea.Msg) tea.Cmd {
	w.resizeActiveScreen()
	defer w.resizeActiveScreen()
	switch m := msg.(type) {
	case tea.KeyPressMsg:
		return w.handleKey(m)
	case screens.NavigateRequest:
		return w.gotoTarget(NavTarget{
			NavID: m.NavID,
			Kind:  Kind(m.Kind),
			ID:    m.ID,
		})
	case devCtxLoadedMsg:
		w.devContext = api.DevtoolsContext(m)
		return nil
	case bridge.Batch:
		return w.handleBridgeBatch(m)
	case storeChangedMsg:
		var revs bridge.Revisions
		return w.handleBridgeBatch(bridge.Batch{StoreChanged: true, Revs: revs})
	case screens.InspectRequest:
		w.inspect.Open(m.Title, m.Subtitle, m.Payload)
		return nil
	case screens.ChooseDefinitionRequest:
		w.definitionChooser.Open(m.Choices)
		return nil
	case paletteResultMsg:
		// Project palette outcomes into the Overview activity feed by
		// synthesizing a InspectEvent and looping it back through Update.
		now := timeNowMs()
		summary := m.OK
		severity := "info"
		if m.Err != "" {
			summary = "✗ " + m.Err
			severity = "error"
		}
		ev := api.InspectEvent{
			Tag:       "InspectEvent",
			Timestamp: now,
			Kind:      "palette",
			Severity:  severity,
			Action:    summary,
		}
		if _, migrated := w.activeScreen().(screens.ResourceScreen); migrated {
			return w.activeScreen().Update(w.ctx, screens.LiveEvents{Events: []api.InspectEvent{ev}}, w.client)
		}
		cmd := w.activeScreen().Update(w.ctx, ev, w.client)
		// Unmigrated screens retain their temporary broad refresh adapter.
		if m.Err == "" {
			cmd = tea.Batch(cmd, w.activeScreen().Init(w.ctx, w.client))
		}
		return cmd
	case browserResultMsg:
		return w.handleBrowserResult(m)
	case statusToastExpiredMsg:
		if w.statusToast == m.Status {
			w.statusToast = ""
		}
		return nil
	}
	if cmd, handled := w.routeOwnedResourceResult(msg); handled {
		return cmd
	}
	cmd := w.activeScreen().Update(w.ctx, msg, w.client)
	w.refreshCounts()
	return cmd
}

// --- helpers -----------------------------------------------------------------

func (w *Workbench) activeScreen() screens.Screen {
	if sc, ok := w.screens[w.activeNav]; ok {
		return sc
	}
	return w.screens["overview"]
}

func (w *Workbench) refreshCounts() {
	if c := w.activeScreen().Counts(); len(c) > 0 {
		for k, v := range c {
			w.counts[k] = v
		}
	}
}

// --- data-fetch commands ----------------------------------------------------

type devCtxLoadedMsg api.DevtoolsContext

func (w *Workbench) fetchContext() tea.Cmd {
	return func() tea.Msg {
		ctx, err := w.client.DevtoolsContext(w.ctx)
		if err != nil {
			return nil
		}
		return devCtxLoadedMsg(ctx)
	}
}
