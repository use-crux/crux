package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

// Overview screen: 4-column KPI strip, top-insights queue, recent runs,
// 14-day pass-rate ASCII chart, live activity log.
type Overview struct {
	summaryResource  *resource.Resource[api.InspectOverviewRecord]
	insightsResource *resource.Resource[[]api.InspectInsightRecord]
	runsResource     *resource.Resource[[]api.InspectRunRecord]
	activityResource *resource.Resource[[]api.InspectActivityEvent]
	activityOverlay  []api.InspectActivityEvent
	runNames         map[string]string
	runSessions      map[string]string
	stats            *store.StatsResult
	statsTimeseries  []store.TimeseriesBucket

	// Cross-pane cursor state. Overview is the workflow launchpad — j/k
	// moves a cursor through the focused panel; h/l toggles the focused
	// panel between Top Insights and Recent Runs. See S6 in the plan.
	focusedPanel overviewPanel
	// activityScroll is zero when the activity feed is pinned to newest rows.
	// Positive values latch the feed onto older rows while live events arrive.
	activityScroll int
	insightList    *kit.ListPane[api.InspectInsightRecord]
	runList        *kit.ListPane[api.InspectRunRecord]
	size           Size
	activityPage   int
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
	insight, _, ok := o.insightList.Selected()
	if !ok {
		return ""
	}
	return insight.InsightID
}

func inspectOperationID(run api.InspectRunRecord) string {
	if run.OperationID != "" {
		return run.OperationID
	}
	return run.TraceID
}

// SelectedRunID returns the operation ID of the cursor-focused Recent Runs
// row, or "" if no runs are loaded.
func (o *Overview) SelectedRunID() string {
	run, _, ok := o.runList.Selected()
	if !ok {
		return ""
	}
	return inspectOperationID(run)
}

// NewOverview constructs an empty Overview screen.
func NewOverview() *Overview {
	o := &Overview{
		summaryResource: resource.New(func(summary api.InspectOverviewRecord) bool {
			return summary.Tag == ""
		}),
		insightsResource: resource.New(func(insights []api.InspectInsightRecord) bool {
			return len(insights) == 0
		}),
		runsResource: resource.New(func(runs []api.InspectRunRecord) bool {
			return len(runs) == 0
		}),
		activityResource: resource.New(func(activity []api.InspectActivityEvent) bool {
			return len(activity) == 0
		}),
		insightList: kit.NewListPane(func(ins api.InspectInsightRecord) string { return ins.InsightID }),
		runList:     kit.NewListPane(inspectOperationID),
	}
	o.setFocusedPanel(panelInsights)
	return o
}

func (o *Overview) ID() string { return "overview" }

func (o *Overview) Init(ctx context.Context, client DataClient) tea.Cmd {
	return o.Refresh(ctx, client, bridge.Invalidations{
		bridge.OverviewSummaryResource:  0,
		bridge.OverviewInsightsResource: 0,
		bridge.OverviewRunsResource:     0,
		bridge.OverviewActivityResource: 0,
	})
}

// Deactivate cancels in-flight projections and returns the exact names that
// must be retried if Overview is opened again.
func (o *Overview) Deactivate() bridge.Invalidations {
	invalidations := bridge.Invalidations{}
	cancelPendingResource(invalidations, bridge.OverviewSummaryResource, o.summaryResource)
	cancelPendingResource(invalidations, bridge.OverviewInsightsResource, o.insightsResource)
	cancelPendingResource(invalidations, bridge.OverviewRunsResource, o.runsResource)
	cancelPendingResource(invalidations, bridge.OverviewActivityResource, o.activityResource)
	return invalidations
}

// Refresh schedules each named Overview projection at most once.
func (o *Overview) Refresh(ctx context.Context, client DataClient, invalidations bridge.Invalidations) tea.Cmd {
	commands := make([]tea.Cmd, 0, 4)
	if revision, ok := invalidations.Revision(bridge.OverviewSummaryResource); ok || o.summaryResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, o.fetchSummaryAtRevision(ctx, client, revision))
	}
	if revision, ok := invalidations.Revision(bridge.OverviewInsightsResource); ok || o.insightsResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, o.fetchInsightsAtRevision(ctx, client, revision))
	}
	if revision, ok := invalidations.Revision(bridge.OverviewRunsResource); ok || o.runsResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, o.fetchRunsAtRevision(ctx, client, revision))
	}
	if revision, ok := invalidations.Revision(bridge.OverviewActivityResource); ok || o.activityResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, o.fetchActivityAtRevision(ctx, client, 12, revision))
	}
	return tea.Batch(commands...)
}

func (o *Overview) Update(ctx context.Context, msg tea.Msg, client DataClient) tea.Cmd {
	switch m := msg.(type) {
	case overviewLoadedMsg:
		if o.summaryResource.Apply(m.Result) {
			if m.StatsLoaded {
				o.stats = m.Stats
			}
			if m.TimeseriesLoaded {
				o.statsTimeseries = m.Timeseries
			}
		}
	case insightsLoadedMsg:
		if o.insightsResource.Apply(resource.ResourceResult[[]api.InspectInsightRecord](m)) {
			o.insightList.SetItems(o.insightRows())
		}
	case runsLoadedMsg:
		if o.runsResource.Apply(m.Result) {
			o.runNames = m.Names
			o.runSessions = m.Sessions
			o.runList.SetItems(o.runRows())
		}
	case activityLoadedMsg:
		if o.activityResource.Apply(resource.ResourceResult[[]api.InspectActivityEvent](m)) {
			o.reconcileActivityOverlay(o.activityResource.Snapshot().Value)
			o.clampActivityScroll()
		}
	case LiveEvents:
		inserted := o.prependLiveActivities(m.Events, 12)
		if inserted > 0 && o.activityScroll > 0 {
			o.activityScroll += inserted
			o.clampActivityScroll()
		}
	case tea.KeyPressMsg:
		return o.handleKey(ctx, m, client)
	}
	return nil
}

// handleKey owns the navigable-Overview keymap. j/k cycles within the
// focused panel; h/l toggles focus between Top Insights and Recent Runs.
// See S6 in the implementation plan.
func (o *Overview) handleKey(ctx context.Context, msg tea.KeyPressMsg, client DataClient) tea.Cmd {
	cmd, _ := interaction.Dispatch(o.Actions(ctx, client), msg)
	return cmd
}

func (o *Overview) shiftFocus(delta int) {
	next := int(o.focusedPanel) + delta
	if next < int(panelInsights) {
		next = int(panelInsights)
	}
	if next > int(panelActivity) {
		next = int(panelActivity)
	}
	o.setFocusedPanel(overviewPanel(next))
}

// drill returns a tea.Cmd that emits a NavigateRequest based on the focused
// panel and cursor. The destination owns the exact record ID as a route
// parameter. An empty focused list returns nil.
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
		if delta > 0 {
			o.insightList.Update(tea.KeyPressMsg{Text: "j", Code: 'j'})
		} else {
			o.insightList.Update(tea.KeyPressMsg{Text: "k", Code: 'k'})
		}
	case panelRuns:
		if delta > 0 {
			o.runList.Update(tea.KeyPressMsg{Text: "j", Code: 'j'})
		} else {
			o.runList.Update(tea.KeyPressMsg{Text: "k", Code: 'k'})
		}
	case panelActivity:
		o.activityScroll += delta
		if o.activityScroll < 0 {
			o.activityScroll = 0
		}
		maxScroll := len(o.projectedActivityRows()) - 1
		if maxScroll < 0 {
			maxScroll = 0
		}
		if o.activityScroll > maxScroll {
			o.activityScroll = maxScroll
		}
	}
}

func (o *Overview) Breadcrumb() ([]string, string) {
	return []string{"overview"}, ""
}

func (o *Overview) Counts() map[string]int {
	return map[string]int{
		"insights": o.overviewSummary().InsightCount,
		"runs":     o.overviewSummary().RunCount,
	}
}
