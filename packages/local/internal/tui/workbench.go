package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/overlays"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func timeNowMs() int64 { return time.Now().UnixMilli() }

var workbenchStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

// osc8Link wraps `text` in an OSC 8 hyperlink escape so terminals that
// support the protocol render `text` as a clickable link to `url`.
// Terminals that don't support OSC 8 render `text` plain (the escape
// is silently consumed). BEL-terminated form (`\x07`) is widest-compat.
//
// Reference: https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
func osc8Link(url, text string) string {
	return "\x1b]8;;" + url + "\x07" + text + "\x1b]8;;\x07"
}

// Workbench is the post-boot V1 Panels root model. It owns the nav rail,
// status bar, breadcrumb, and the active Inspect screen. The four-section
// tab strip was dropped in S2 — the workbench IS the Inspect workbench;
// there is no second-level navigation above the nav rail.
type Workbench struct {
	client          screens.DataClient
	rawClient       DataClient // legacy/shared helpers
	capabilities    Capabilities
	serverURL       string
	tunnelURL       string
	ingestTokenPath string

	width  int
	height int

	activeNav   string
	screens     map[string]screens.Screen
	counts      map[string]int
	stale       map[string]bridge.Domains
	initialized map[string]bool
	devContext  api.DevtoolsContext

	pendingPrefix string // for `g…` two-key sequences

	// selection is the cross-screen record store keyed by Kind. Per the
	// approved 2026-07-16 TUI stabilization design, read/write via
	// GetSelection / SetSelection /
	// ClearSelection — screens never touch the map directly.
	selection map[Kind]string

	palette *overlays.Palette
	help    *overlays.Help
	inspect *overlays.Inspect

	onQuitRequested func()
}

// NewWorkbench constructs the workbench root.
func NewWorkbench(client screens.DataClient, rawClient DataClient, serverURL string) *Workbench {
	w := &Workbench{
		client:       client,
		rawClient:    rawClient,
		capabilities: discoverCapabilities(client),
		serverURL:    serverURL,
		activeNav:    "overview",
		counts:       map[string]int{},
		stale:        map[string]bridge.Domains{},
		initialized:  map[string]bool{},
		palette:      overlays.NewPalette(),
		help:         overlays.NewHelp(),
		inspect:      overlays.NewInspect(),
	}
	w.screens = map[string]screens.Screen{
		"overview": screens.NewOverview(),
		"insights": screens.NewInsights(),
		"runs":     screens.NewRuns(),
		"index":    screens.NewIndex(),
	}
	return w
}

// SetQuitRequestedCallback registers the process-level cleanup notification
// invoked immediately before a workspace quit command is returned.
func (w *Workbench) SetQuitRequestedCallback(fn func()) {
	w.onQuitRequested = fn
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

// Init is called once to fire initial fetches for the active screen and the
// devtools context.
func (w *Workbench) Init() tea.Cmd {
	w.initialized[w.activeNav] = true
	return tea.Batch(
		w.fetchContext(),
		w.activeScreen().Init(w.client),
	)
}

// Resize updates the cached viewport dimensions.
func (w *Workbench) Resize(width, height int) {
	w.width = width
	w.height = height
}

// Update routes a tea.Msg through the active screen and handles global keys.
func (w *Workbench) Update(msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case tea.KeyPressMsg:
		return w.handleKey(m)
	case screens.NavigateRequest:
		// A screen asked to drill cross-screen. Stage the selection (if
		// any) and switch active nav per the approved stabilization design.
		if m.Kind != "" && m.ID != "" {
			w.SetSelection(Kind(m.Kind), m.ID)
		}
		if m.NavID != "" {
			return w.gotoNav(m.NavID)
		}
		return nil
	case devCtxLoadedMsg:
		w.devContext = api.DevtoolsContext(m)
		return nil
	case bridge.Batch:
		return w.handleBridgeBatch(m)
	case inspectEventMsg:
		ev := api.InspectEvent(m)
		var revs bridge.Revisions
		changed := revs.BumpInspect(ev)
		return w.handleBridgeBatch(bridge.Batch{
			Inspect: []api.InspectEvent{ev},
			Revs:    revs,
			Changed: changed,
		})
	case storeChangedMsg:
		var revs bridge.Revisions
		return w.handleBridgeBatch(bridge.Batch{StoreChanged: true, Revs: revs})
	case screens.InspectRequest:
		w.inspect.Open(m.Title, m.Subtitle, m.Payload)
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
		cmd := w.activeScreen().Update(ev, w.client)
		// If the action likely changed state (no error), kick a re-fetch.
		if m.Err == "" {
			cmd = tea.Batch(cmd, w.activeScreen().Init(w.client))
		}
		return cmd
	}
	cmd := w.activeScreen().Update(msg, w.client)
	w.refreshCounts()
	return cmd
}

// View renders the full TUI surface.
//
// Layout (top → bottom): breadcrumb row · body (nav rail │ screen) · status
// bar. The four-section tab strip was dropped in S2 because three of its
// four tabs were placeholders for surfaces that have been folded into the
// Inspect workbench. The breadcrumb row absorbs the system-health block
// (server · collector · version · project:target git) on its right side.
func (w *Workbench) View() string {
	if w.width == 0 || w.height == 0 {
		return ""
	}

	root := kit.Rect{W: w.width, H: w.height}
	regions := kit.SplitV(root, kit.Fill(), kit.Fixed(1))
	bodyRect := regions[0]
	statusRect := regions[1]

	statusBar := shell.StatusBar(statusRect.W, w.statusKeybinds(), ".crux/evals")

	path, right := w.activeScreen().Breadcrumb()
	if right == "" {
		right = w.contextMeta()
	}
	// Workspace prefix: `{project}:{target}` becomes the leading segment
	// when both are known. Screens return only their screen-local segments;
	// the workbench owns the workspace prefix — see plan S2.
	if proj, tgt := w.devContext.Project.Name, w.devContext.Target.ID; proj != "" && tgt != "" {
		path = append([]string{proj + ":" + tgt}, path...)
	}

	bodyLines := w.layoutBody(bodyRect, path, right)
	base := strings.Join(append(bodyLines, statusBar), "\n")

	if w.palette.IsOpen() {
		return overlayOnto(base, w.palette.View(w.width, w.height), w.width, 1)
	}
	if w.help.IsOpen() {
		return overlayOnto(base, w.help.View(w.width, w.height), w.width, 0)
	}
	if w.inspect.IsOpen() {
		return overlayOnto(base, w.inspect.View(w.width, w.height), w.width, 0)
	}
	return base
}

func (w *Workbench) layoutBody(bodyRect kit.Rect, path []string, right string) []string {
	if kit.Classify(bodyRect.W) == kit.LayoutSingle {
		return w.layoutScreenColumn(bodyRect, path, right)
	}

	navItems := w.navWithCounts()
	panes := kit.SplitH(bodyRect, kit.Fixed(shell.NavRailWidth), kit.Fill())
	rail := shell.NavRail(panes[0].H, navItems, w.activeNav, shell.NavRailFooter{
		TargetID:         w.devContext.Target.ID,
		TargetKind:       w.devContext.Target.Kind,
		TargetModel:      w.devContext.Target.Model,
		BaselineLabel:    w.devContext.Baseline.Label,
		BaselineRelative: w.devContext.Baseline.PromotedAtRelative,
	})
	screen := w.layoutScreenColumn(panes[1], path, right)

	return kit.ComposeStyled(panes, [][]string{
		blockLines(rail),
		screen,
	}, workbenchStyles)
}

func (w *Workbench) layoutScreenColumn(r kit.Rect, path []string, right string) []string {
	if r.W <= 0 || r.H <= 0 {
		return nil
	}
	breadcrumb := shell.Breadcrumb(r.W, path, right)
	breadcrumbH := len(blockLines(breadcrumb))
	screenH := r.H - breadcrumbH
	if screenH < 0 {
		screenH = 0
	}
	screenView := w.activeScreen().View(screens.Size{Width: r.W, Height: screenH})
	return blockLines(kit.PadBlock(breadcrumb+"\n"+screenView, r.W, r.H))
}

// overlayOnto splices `overlay` into `base` starting at top-line `top`, with
// the overlay centered horizontally inside `width` columns. Lines below the
// overlay shift down — but in the V1 panels the overlay is short enough to
// just replace lines instead.
func overlayOnto(base, overlay string, width, top int) string {
	if overlay == "" {
		return base
	}
	baseLines := strings.Split(base, "\n")
	overlayLines := strings.Split(overlay, "\n")
	overlayWidth := 0
	for _, ln := range overlayLines {
		w := lipgloss.Width(ln)
		if w > overlayWidth {
			overlayWidth = w
		}
	}
	leftPad := (width - overlayWidth) / 2
	if leftPad < 1 {
		leftPad = 1
	}
	height := len(baseLines)
	if overlayH := top + len(overlayLines); overlayH > height {
		height = overlayH
	}
	canvas := lipgloss.NewCanvas(width, height)
	canvas.Compose(lipgloss.NewLayer(base))
	canvas.Compose(lipgloss.NewLayer(overlay).X(leftPad).Y(top).Z(1))
	return canvas.Render()
}

func blockLines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(strings.TrimRight(s, "\n"), "\n")
}

// contextMeta composes the right-side block of the breadcrumb row.
// After S2 dropped the tab strip, this absorbs everything the strip used
// to show: server URL, version, project context, and git status.
func (w *Workbench) contextMeta() string {
	parts := make([]string, 0, 5)

	// Server URLs — render compact chips wrapped in OSC 8 hyperlinks so
	// modern terminals make them clickable. Display strips scheme/query,
	// while the link target keeps the full authenticated URL.
	if w.serverURL != "" {
		parts = append(parts, osc8Link(w.serverURL, "local "+compactURLLabel(w.serverURL)))
	}
	if w.tunnelURL != "" {
		parts = append(parts, osc8Link(w.tunnelURL, "tunnel "+compactURLLabel(w.tunnelURL)))
	}
	if w.ingestTokenPath != "" {
		parts = append(parts, "ingest token "+w.ingestTokenPath)
	}

	if w.devContext.Version != "" {
		parts = append(parts, w.devContext.Version)
	}

	if w.devContext.Project.Name != "" {
		parts = append(parts, "project · "+w.devContext.Project.Name)
	}
	if w.devContext.Git.Branch != "" {
		git := w.devContext.Git.Branch
		if w.devContext.Git.CommitSHA != "" {
			sha := w.devContext.Git.CommitSHA
			if len(sha) > 7 {
				sha = sha[:7]
			}
			git += " @ " + sha
		}
		if w.devContext.Git.Dirty {
			git += " *"
		}
		parts = append(parts, git)
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "  ·  ")
}

func compactURLLabel(raw string) string {
	label := raw
	if i := strings.Index(label, "://"); i >= 0 {
		label = label[i+3:]
	}
	if i := strings.IndexAny(label, "?#"); i >= 0 {
		label = label[:i]
	}
	return label
}

// runPaletteCommand dispatches a parsed palette command. Verbs map to typed
// methods on the in-process DirectClient. Unknown verbs produce a transient
// toast in the activity tail.
func (w *Workbench) runPaletteCommand(c overlays.Chosen) tea.Cmd {
	switch c.Verb {
	case "quit", "q", "exit":
		return tea.Quit
	case "goto", "g":
		if len(c.Args) == 0 {
			return w.toast("goto: missing screen name")
		}
		return w.gotoNav(c.Args[0])
	case "dismiss":
		// `dismiss insight <ID>` or just `dismiss <ID>` on Insights screen.
		id := ""
		if len(c.Args) >= 2 && c.Args[0] == "insight" {
			id = c.Args[1]
		} else if len(c.Args) >= 1 {
			id = c.Args[0]
		} else {
			return w.toast("usage: dismiss insight <ID>")
		}
		client := w.client
		return func() tea.Msg {
			_, err := client.SetInsightStatus(context.Background(), id, api.InspectInsightStatusRequest{Status: "dismissed"})
			if err != nil {
				return paletteResultMsg{Err: err.Error()}
			}
			return paletteResultMsg{OK: "dismissed " + id}
		}
	}
	return w.toast("unknown command: " + c.Verb)
}

// paletteResultMsg surfaces the outcome of a palette-dispatched action.
type paletteResultMsg struct {
	OK  string
	Err string
}

// toast returns a tea.Cmd that publishes a transient activity entry to the
// Overview screen via an Activity event without touching the bus.
func (w *Workbench) toast(text string) tea.Cmd {
	return func() tea.Msg {
		return paletteResultMsg{OK: text}
	}
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

func (w *Workbench) projectSubtitle() string {
	if w.devContext.Project.Name == "" {
		return w.serverURL
	}
	suffix := ""
	if w.devContext.Git.Branch != "" {
		suffix = " · " + w.devContext.Git.Branch
		if w.devContext.Git.CommitSHA != "" {
			suffix += " @ " + truncateStr(w.devContext.Git.CommitSHA, 7)
		}
	}
	return fmt.Sprintf("%s%s", w.devContext.Project.Name, suffix)
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// --- data-fetch commands ----------------------------------------------------

type devCtxLoadedMsg api.DevtoolsContext
type inspectEventMsg api.InspectEvent

func (w *Workbench) fetchContext() tea.Cmd {
	return func() tea.Msg {
		ctx, err := w.client.DevtoolsContext(context.Background())
		if err != nil {
			return nil
		}
		return devCtxLoadedMsg(ctx)
	}
}

// SubscribeEvents wires the Inspect event bus into the Bubble Tea program.
// `send` is the program's Send func (captured from SetProgram).
func (w *Workbench) SubscribeEvents(ctx context.Context, send func(tea.Msg)) {
	ch := w.client.SubscribeInspect(ctx)
	go func() {
		for ev := range ch {
			send(inspectEventMsg(ev))
		}
	}()
}

// Compile-time assertion that lipgloss is referenced (silences unused import
// in some builds where the only usages are inside template strings).
var _ = lipgloss.NoColor{}
