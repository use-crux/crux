package screens

import (
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Overview screen: 4-column KPI strip, top-insights queue, recent runs,
// 14-day pass-rate ASCII chart, live activity log.
type Overview struct {
	overview api.QualityOverviewRecord
	insights []api.QualityInsightRecord
	runs     []api.QualityRunRecord
	activity []api.QualityActivityEvent
	loaded   bool
	err      string

	// Cross-pane cursor state. Overview is the workflow launchpad — j/k
	// moves a cursor through the focused panel; h/l toggles the focused
	// panel between Top Insights and Recent Runs. See S6 in the plan.
	focusedPanel overviewPanel
	insightCur   int
	runCur       int
	// activityScroll is zero when the activity feed is pinned to newest rows.
	// Positive values latch the feed onto older rows while live events arrive.
	activityScroll int
	insightList  kit.VList[api.QualityInsightRecord]
	runList      kit.VList[api.QualityRunRecord]
}

type overviewPanel int

const (
	panelInsights overviewPanel = iota
	panelRuns
	panelActivity
)

// SelectedInsightID returns the InsightID of the cursor-focused Top
// Insights row, or "" if no insights are loaded.
func (o *Overview) SelectedInsightID() string {
	if o.insightCur < 0 || o.insightCur >= len(o.insights) {
		return ""
	}
	return o.insights[o.insightCur].InsightID
}

// SelectedRunID returns the TraceID of the cursor-focused Recent Runs
// row, or "" if no runs are loaded.
func (o *Overview) SelectedRunID() string {
	runs := o.recentRunsList()
	if o.runCur < 0 || o.runCur >= len(runs) {
		return ""
	}
	return runs[o.runCur].TraceID
}

// recentRunsList resolves the right source for the runs panel — the
// overview-embedded list if present, otherwise the recent-runs fallback.
func (o *Overview) recentRunsList() []api.QualityRunRecord {
	if len(o.overview.RecentRuns) > 0 {
		return o.overview.RecentRuns
	}
	return o.runs
}

// NewOverview constructs an empty Overview screen.
func NewOverview() *Overview {
	o := &Overview{}
	o.insightList.SetIdentity(func(ins api.QualityInsightRecord) string { return ins.InsightID })
	o.runList.SetIdentity(func(run api.QualityRunRecord) string { return run.TraceID })
	return o
}

func (o *Overview) ID() string { return "overview" }

func (o *Overview) Interested(domains bridge.Domains) bool {
	return domains.Intersects(bridge.NewDomains(
		bridge.DomainRuns,
		bridge.DomainInsights,
		bridge.DomainExperiments,
		bridge.DomainBaselines,
		bridge.DomainFeedback,
		bridge.DomainCassettes,
		bridge.DomainActivity,
	))
}

func (o *Overview) Init(client DataClient) tea.Cmd {
	return tea.Batch(
		fetchOverview(client),
		fetchInsights(client),
		fetchRuns(client),
		fetchActivity(client, 12),
	)
}

func (o *Overview) Update(msg tea.Msg, client DataClient) tea.Cmd {
	switch m := msg.(type) {
	case overviewLoadedMsg:
		o.overview = api.QualityOverviewRecord(m.rec)
		o.loaded = true
		o.syncLists()
	case insightsLoadedMsg:
		o.insights = []api.QualityInsightRecord(m)
		o.syncLists()
	case runsLoadedMsg:
		o.runs = []api.QualityRunRecord(m)
		o.syncLists()
	case activityLoadedMsg:
		o.activity = []api.QualityActivityEvent(m)
	case dataErrMsg:
		o.err = string(m)
	case api.QualityEvent:
		// A typed event arrived from the bus. Optimistically prepend it as
		// an activity row + re-fetch in the background.
		o.activity = prependActivity(o.activity, activityFromEvent(m), 12)
		if o.activityScroll > 0 {
			o.activityScroll++
		}
		return tea.Batch(
			fetchOverview(client),
			fetchActivity(client, 12),
		)
	case tea.KeyPressMsg:
		return o.handleKey(m)
	}
	return nil
}

// handleKey owns the navigable-Overview keymap. j/k cycles within the
// focused panel; h/l toggles focus between Top Insights and Recent Runs.
// See S6 in the implementation plan.
func (o *Overview) handleKey(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "j", "down":
		o.moveCursor(+1)
	case "k", "up":
		o.moveCursor(-1)
	case "h", "left":
		o.shiftFocus(-1)
	case "l", "right":
		o.shiftFocus(+1)
	case "enter":
		return o.drill()
	}
	return nil
}

func (o *Overview) shiftFocus(delta int) {
	next := int(o.focusedPanel) + delta
	if next < int(panelInsights) {
		next = int(panelInsights)
	}
	if next > int(panelActivity) {
		next = int(panelActivity)
	}
	o.focusedPanel = overviewPanel(next)
}

// drill returns a tea.Cmd that emits a NavigateRequest based on the
// focused panel + cursor — the workbench picks it up, stages the id in
// the cross-screen selection store, and jumps to the destination screen.
// See ADR-0051. If no record is focused (empty list), returns nil.
func (o *Overview) drill() tea.Cmd {
	var req NavigateRequest
	switch o.focusedPanel {
	case panelInsights:
		id := o.SelectedInsightID()
		if id == "" {
			return nil
		}
		req = NavigateRequest{NavID: "insights", Kind: "insight", ID: id}
	case panelRuns:
		id := o.SelectedRunID()
		if id == "" {
			return nil
		}
		req = NavigateRequest{NavID: "runs", Kind: "run", ID: id}
	default:
		return nil
	}
	return func() tea.Msg { return req }
}

func (o *Overview) moveCursor(delta int) {
	switch o.focusedPanel {
	case panelInsights:
		o.insightList.SetItems(o.insights)
		o.insightList.SetCursorByIdentity(o.SelectedInsightID())
		if delta > 0 {
			o.insightList.CursorDown()
		} else {
			o.insightList.CursorUp()
		}
		_, idx, ok := o.insightList.Cursor()
		if ok {
			o.insightCur = idx
		}
	case panelRuns:
		runs := o.recentRunsList()
		o.runList.SetItems(runs)
		o.runList.SetCursorByIdentity(o.SelectedRunID())
		if delta > 0 {
			o.runList.CursorDown()
		} else {
			o.runList.CursorUp()
		}
		_, idx, ok := o.runList.Cursor()
		if ok {
			o.runCur = idx
		}
	case panelActivity:
		o.activityScroll += delta
		if o.activityScroll < 0 {
			o.activityScroll = 0
		}
		maxScroll := len(o.activity) - 1
		if maxScroll < 0 {
			maxScroll = 0
		}
		if o.activityScroll > maxScroll {
			o.activityScroll = maxScroll
		}
	}
}

func (o *Overview) syncLists() {
	o.insightList.SetItems(o.insights)
	if o.insightCur < len(o.insights) {
		o.insightList.SetCursorByIdentity(o.SelectedInsightID())
	}
	runs := o.recentRunsList()
	o.runList.SetItems(runs)
	if o.runCur < len(runs) {
		o.runList.SetCursorByIdentity(o.SelectedRunID())
	}
}

func activityFromEvent(ev api.QualityEvent) api.QualityActivityEvent {
	summary := ev.Action
	if ev.Kind != "" {
		summary = ev.Kind + " " + ev.RefID
	}
	return api.QualityActivityEvent{
		Tag:       "QualityActivityEvent",
		Timestamp: ev.Timestamp,
		Kind:      ev.Kind,
		Severity:  ev.Severity,
		Summary:   summary,
		RefID:     ev.RefID,
	}
}

func prependActivity(existing []api.QualityActivityEvent, ev api.QualityActivityEvent, limit int) []api.QualityActivityEvent {
	out := append([]api.QualityActivityEvent{ev}, existing...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (o *Overview) Breadcrumb() ([]string, string) {
	return []string{"overview"}, ""
}

func (o *Overview) Keybinds() []shell.Keybind {
	// Overview is read-only — no selection state, no row-level actions. The
	// hints below are the nav shortcuts that work everywhere.
	return []shell.Keybind{
		{Key: "g i", Label: "insights"},
		{Key: "g r", Label: "runs"},
		{Key: "g x", Label: "experiments"},
		{Key: "g s", Label: "suites"},
		{Key: ":", Label: "cmd"},
		{Key: "?", Label: "help"},
		{Key: "q", Label: "quit"},
	}
}

func (o *Overview) Counts() map[string]int {
	return map[string]int{
		"insights":    o.overview.InsightCount,
		"runs":        o.overview.RunCount,
		"experiments": o.overview.ExperimentCount,
		"baselines":   o.overview.BaselineCount,
		"feedback":    o.overview.FeedbackCount,
		"cassettes":   o.overview.CassetteCount,
	}
}
