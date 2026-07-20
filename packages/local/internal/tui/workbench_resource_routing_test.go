package tui

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type cancelOnNavigationClient struct {
	*uitest.FixtureClient
	mu           sync.Mutex
	blockSummary bool
	summaryCalls int
	started      chan context.Context
}

func (c *cancelOnNavigationClient) Overview(ctx context.Context) (api.InspectOverviewRecord, error) {
	c.mu.Lock()
	c.summaryCalls++
	block := c.blockSummary
	c.mu.Unlock()
	if block {
		c.started <- ctx
		<-ctx.Done()
		return api.InspectOverviewRecord{}, ctx.Err()
	}
	return c.FixtureClient.Overview(ctx)
}

func (c *cancelOnNavigationClient) setBlockSummary(block bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.blockSummary = block
}

func (c *cancelOnNavigationClient) calls() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.summaryCalls
}

func TestWorkbenchAppliesOverviewRefreshResultAfterNavigatingAway(t *testing.T) {
	client := &bridgeCountingClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	w.Resize(120, 36)
	runWorkbenchCommands(w, w.Init())

	pending := w.Update(bridge.Batch{
		Inspect: []api.InspectEvent{{Kind: "run", Action: "changed", RefID: "run-1"}},
		Changed: bridge.NewDomains(bridge.DomainRuns, bridge.DomainActivity),
		Revs:    bridge.Revisions{Runs: 1, Activity: 1},
	})
	runWorkbenchCommands(w, w.gotoNav("index"))
	runWorkbenchCommands(w, pending)
	runWorkbenchCommands(w, w.gotoNav("overview"))

	if view := strings.ToLower(w.View()); strings.Contains(view, "refreshing") {
		t.Fatalf("completed Overview refresh remained stuck after navigation:\n%s", view)
	}
}

func TestWorkbenchCancelsDepartedResourceRequestAndRetriesOnReturn(t *testing.T) {
	client := &cancelOnNavigationClient{
		FixtureClient: uitest.NewFixtureClient(),
		started:       make(chan context.Context, 1),
	}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	runWorkbenchCommands(w, w.Init())
	overview := w.screens["overview"].(*screens.Overview)
	client.setBlockSummary(true)

	pending := overview.Refresh(w.ctx, client, bridge.Invalidations{bridge.OverviewSummaryResource: 1})
	result := make(chan tea.Msg, 1)
	go func() { result <- pending() }()

	var requestContext context.Context
	select {
	case requestContext = <-client.started:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for Overview summary request")
	}
	runWorkbenchCommands(w, w.gotoNav("index"))
	select {
	case <-requestContext.Done():
	case <-time.After(time.Second):
		t.Fatal("leaving Overview did not cancel its active summary request")
	}
	select {
	case msg := <-result:
		runWorkbenchCommands(w, w.Update(msg))
	case <-time.After(time.Second):
		t.Fatal("canceled Overview request did not return")
	}

	client.setBlockSummary(false)
	before := client.calls()
	runWorkbenchCommands(w, w.gotoNav("overview"))
	if got := client.calls(); got != before+1 {
		t.Fatalf("Overview summary calls after return = %d, want retry call %d", got, before+1)
	}
}
