package tui

import (
	"context"
	"errors"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type bridgeCountingClient struct {
	*uitest.FixtureClient
	summaryCalls  int
	insightsCalls int
	runsCalls     int
	activityCalls int
	indexCalls    int
	indexErr      error
	indexData     *api.IndexData
}

func (c *bridgeCountingClient) Overview(ctx context.Context) (api.InspectOverviewRecord, error) {
	c.summaryCalls++
	return c.FixtureClient.Overview(ctx)
}

func (c *bridgeCountingClient) Insights(ctx context.Context) ([]api.InspectInsightRecord, error) {
	c.insightsCalls++
	return c.FixtureClient.Insights(ctx)
}

func (c *bridgeCountingClient) Runs(ctx context.Context) ([]api.InspectRunRecord, error) {
	c.runsCalls++
	return c.FixtureClient.Runs(ctx)
}

func (c *bridgeCountingClient) Activity(ctx context.Context, limit int) ([]api.InspectActivityEvent, error) {
	c.activityCalls++
	return c.FixtureClient.Activity(ctx, limit)
}

func (c *bridgeCountingClient) ProjectIndex(ctx context.Context) (api.IndexData, error) {
	c.indexCalls++
	if c.indexErr != nil {
		return api.IndexData{}, c.indexErr
	}
	if c.indexData != nil {
		return *c.indexData, nil
	}
	return c.FixtureClient.ProjectIndex(ctx)
}

func (c *bridgeCountingClient) reset() {
	c.summaryCalls = 0
	c.insightsCalls = 0
	c.runsCalls = 0
	c.activityCalls = 0
	c.indexCalls = 0
}

func TestWorkbenchBridgeBurstRefreshesEachActiveOverviewResourceOnce(t *testing.T) {
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	runWorkbenchCommands(w, w.Init())
	client.reset()

	runWorkbenchCommands(w, w.Update(bridge.Batch{
		Inspect: []api.InspectEvent{
			{Kind: "run", Action: "changed", RefID: "run-1"},
			{Kind: "run", Action: "changed", RefID: "run-2"},
			{Kind: "run", Action: "changed", RefID: "run-3"},
		},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
		Revs:    bridge.Revisions{Runs: 3, Activity: 3},
	}))

	if client.summaryCalls != 1 || client.runsCalls != 1 || client.activityCalls != 1 {
		t.Fatalf("run burst calls = summary:%d runs:%d activity:%d, want one each",
			client.summaryCalls, client.runsCalls, client.activityCalls)
	}
	if client.insightsCalls != 0 {
		t.Fatalf("run burst refreshed unrelated insights %d time(s)", client.insightsCalls)
	}
}

func TestWorkbenchDefersInactiveOverviewInvalidationsAndDrainsOnlyAffectedResources(t *testing.T) {
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	runWorkbenchCommands(w, w.Init())
	runWorkbenchCommands(w, w.gotoNav("index"))
	client.reset()

	runWorkbenchCommands(w, w.Update(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "run", Action: "changed", RefID: "run-1"}},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
		Revs:    bridge.Revisions{Runs: 1, Activity: 1},
	}))
	if client.summaryCalls != 0 || client.insightsCalls != 0 || client.runsCalls != 0 || client.activityCalls != 0 {
		t.Fatalf("inactive Overview fetched eagerly: summary:%d insights:%d runs:%d activity:%d",
			client.summaryCalls, client.insightsCalls, client.runsCalls, client.activityCalls)
	}

	runWorkbenchCommands(w, w.gotoNav("overview"))
	if client.summaryCalls != 1 || client.runsCalls != 1 || client.activityCalls != 1 {
		t.Fatalf("deferred run invalidation calls = summary:%d runs:%d activity:%d, want one each",
			client.summaryCalls, client.runsCalls, client.activityCalls)
	}
	if client.insightsCalls != 0 {
		t.Fatalf("deferred run invalidation refreshed unrelated insights %d time(s)", client.insightsCalls)
	}

	runWorkbenchCommands(w, w.gotoNav("index"))
	runWorkbenchCommands(w, w.gotoNav("overview"))
	if client.summaryCalls != 1 || client.insightsCalls != 0 || client.runsCalls != 1 || client.activityCalls != 1 {
		t.Fatalf("clean re-entry refetched Overview: summary:%d insights:%d runs:%d activity:%d",
			client.summaryCalls, client.insightsCalls, client.runsCalls, client.activityCalls)
	}
}

func TestInsightStatusEventInvalidatesOverviewInsightsProjection(t *testing.T) {
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	runWorkbenchCommands(w, w.Init())
	runWorkbenchCommands(w, w.gotoNav("insights"))
	client.reset()

	runWorkbenchCommands(w, w.Update(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "insight", Action: "activity", RefID: "INS-014"}},
		Changed: bridge.NewDomains(bridge.DomainInsights, bridge.DomainActivity),
		Revs:    bridge.Revisions{Insights: 4, Activity: 4},
	}))
	if client.insightsCalls != 1 {
		t.Fatalf("active Insights refresh calls = %d, want 1", client.insightsCalls)
	}

	runWorkbenchCommands(w, w.gotoNav("overview"))
	if client.insightsCalls != 2 {
		t.Fatalf("Overview named insights refresh calls = %d, want 2 total", client.insightsCalls)
	}
}

func TestWorkbenchBridgeBurstRefreshesActiveIndexSnapshotOnce(t *testing.T) {
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	runWorkbenchCommands(w, w.Init())
	runWorkbenchCommands(w, w.gotoNav("index"))
	client.reset()

	runWorkbenchCommands(w, w.Update(bridge.Batch{
		Inspect: []api.InspectEvent{
			{Kind: "index", Action: "changed"},
			{Kind: "project-index", Action: "changed"},
			{Kind: "index", Action: "changed"},
		},
		Changed: bridge.NewDomains(bridge.DomainIndex),
		Revs:    bridge.Revisions{Index: 3},
	}))

	if client.indexCalls != 1 {
		t.Fatalf("index burst refreshed snapshot %d times, want once", client.indexCalls)
	}
}

func TestWorkbenchNamedIndexRefreshFailureKeepsLastGoodViewDegraded(t *testing.T) {
	indexData := api.IndexData{Definitions: []api.ProjectDefinition{{ID: "prompt:writer.prompt", Kind: "prompt", Name: "writer.prompt"}}}
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient(), indexData: &indexData}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	w.Resize(100, 30)
	runWorkbenchCommands(w, w.Init())
	runWorkbenchCommands(w, w.gotoNav("index"))
	client.indexErr = errors.New("index watcher unavailable")

	runWorkbenchCommands(w, w.Update(bridge.Batch{
		IndexChanged: true,
		Changed:      bridge.NewDomains(bridge.DomainIndex),
		Revs:         bridge.Revisions{Index: 1},
	}))
	view := w.View()
	for _, want := range []string{"degraded", "index watche", "writer.prompt"} {
		if !strings.Contains(view, want) {
			t.Fatalf("named degraded Index view omitted %q:\n%s", want, view)
		}
	}
}

func TestPaletteOutcomeDoesNotBlindlyRefetchMigratedOverview(t *testing.T) {
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	runWorkbenchCommands(w, w.Init())
	client.reset()

	runWorkbenchCommands(w, w.Update(paletteResultMsg{OK: "operation completed"}))

	if client.summaryCalls != 0 || client.insightsCalls != 0 || client.runsCalls != 0 || client.activityCalls != 0 {
		t.Fatalf("palette outcome blindly refetched Overview: summary:%d insights:%d runs:%d activity:%d",
			client.summaryCalls, client.insightsCalls, client.runsCalls, client.activityCalls)
	}
}

func runWorkbenchCommands(w *Workbench, cmds ...tea.Cmd) {
	for _, cmd := range cmds {
		if cmd == nil {
			continue
		}
		runWorkbenchMessage(w, cmd())
	}
}

func runWorkbenchMessage(w *Workbench, msg tea.Msg) {
	if batch, ok := msg.(tea.BatchMsg); ok {
		runWorkbenchCommands(w, []tea.Cmd(batch)...)
		return
	}
	if msg != nil {
		runWorkbenchCommands(w, w.Update(msg))
	}
}

func TestWorkbenchBridgeBatchMarksInactiveScreenStaleUntilFocus(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	active := &fakeScreen{id: "overview", interest: bridge.NewDomains(bridge.DomainRuns)}
	inactive := &fakeScreen{id: "insights", interest: bridge.NewDomains(bridge.DomainInsights)}
	w.screens["overview"] = active
	w.screens["insights"] = inactive
	w.activeNav = "overview"

	cmd := w.Update(bridge.Batch{Changed: bridge.NewDomains(bridge.DomainInsights)})
	runCmd(cmd)
	if len(active.updateMsgs) != 0 {
		t.Fatalf("active screen received uninterested bridge batch: %d update(s)", len(active.updateMsgs))
	}
	if inactive.initCalls != 0 || len(inactive.updateMsgs) != 0 {
		t.Fatalf("inactive screen fetched or updated on bridge batch: init=%d updates=%d", inactive.initCalls, len(inactive.updateMsgs))
	}

	runCmd(w.gotoNav("insights"))
	if inactive.initCalls != 1 {
		t.Fatalf("inactive screen init calls after focus = %d, want 1", inactive.initCalls)
	}
}

func TestWorkbenchGotoNavDoesNotRefetchCleanInitializedScreen(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	overview := &fakeScreen{id: "overview", interest: bridge.NewDomains(bridge.DomainRuns)}
	insights := &fakeScreen{id: "insights", interest: bridge.NewDomains(bridge.DomainInsights)}
	w.screens["overview"] = overview
	w.screens["insights"] = insights
	w.activeNav = "overview"

	runCmd(w.gotoNav("insights"))
	if insights.initCalls != 1 {
		t.Fatalf("first insights focus init calls = %d, want 1", insights.initCalls)
	}
	runCmd(w.gotoNav("overview"))
	runCmd(w.gotoNav("insights"))
	if insights.initCalls != 1 {
		t.Fatalf("clean second insights focus init calls = %d, want still 1", insights.initCalls)
	}

	runCmd(w.gotoNav("overview"))
	runCmd(w.Update(bridge.Batch{Changed: bridge.NewDomains(bridge.DomainInsights)}))
	runCmd(w.gotoNav("insights"))
	if insights.initCalls != 2 {
		t.Fatalf("stale insights focus init calls = %d, want 2", insights.initCalls)
	}
}

func runCmd(cmd tea.Cmd) tea.Msg {
	if cmd == nil {
		return nil
	}
	return cmd()
}
