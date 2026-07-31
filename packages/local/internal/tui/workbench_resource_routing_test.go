package tui

import (
	"context"
	"encoding/json"
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

type delayedInsightsEvalClient struct {
	*uitest.FixtureClient
	mu        sync.Mutex
	blockEval bool
	evalCalls int
	started   chan context.Context
}

func (c *delayedInsightsEvalClient) EvalRuns(ctx context.Context) ([]json.RawMessage, error) {
	c.mu.Lock()
	c.evalCalls++
	block := c.blockEval
	c.mu.Unlock()
	if block {
		c.started <- ctx
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return c.FixtureClient.EvalRuns(ctx)
}

func (c *delayedInsightsEvalClient) setBlockEval(block bool) {
	c.mu.Lock()
	c.blockEval = block
	c.mu.Unlock()
}

func (c *delayedInsightsEvalClient) calls() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.evalCalls
}

func TestWorkbenchRetriesOwnedInsightsEvalFetchAfterNavigation(t *testing.T) {
	client := &delayedInsightsEvalClient{
		FixtureClient: uitest.NewFixtureClient(),
		blockEval:     true,
		started:       make(chan context.Context, 1),
	}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	w.Resize(120, 36)
	runWorkbenchCommands(w, w.Init())

	command := w.gotoNav("insights")
	batch, ok := command().(tea.BatchMsg)
	if !ok || len(batch) != 2 {
		t.Fatalf("Insights activation = %#v, want owned list and Eval commands", command)
	}
	// Let the primary list settle while the Cases evidence remains delayed.
	runWorkbenchCommands(w, batch[0])
	pending := make(chan tea.Msg, 1)
	go func() { pending <- batch[1]() }()

	var requestContext context.Context
	select {
	case requestContext = <-client.started:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for Insights Eval request")
	}
	runWorkbenchCommands(w, w.gotoNav("overview"))
	select {
	case <-requestContext.Done():
	case <-time.After(time.Second):
		t.Fatal("leaving Insights did not cancel its Eval request")
	}
	select {
	case stale := <-pending:
		runWorkbenchCommands(w, w.Update(stale))
	case <-time.After(time.Second):
		t.Fatal("canceled Insights Eval request did not return")
	}

	client.setBlockEval(false)
	before := client.calls()
	runWorkbenchCommands(w, w.gotoNav("insights"))
	if got := client.calls(); got != before+1 {
		t.Fatalf("Insights Eval calls after return = %d, want retry call %d", got, before+1)
	}
	// Open the Cases tab and prove the retried evidence, not the stale canceled
	// completion, owns the rendered projection.
	runWorkbenchCommands(w,
		w.Update(tea.KeyPressMsg{Text: "l", Code: 'l'}),
		w.Update(tea.KeyPressMsg{Text: "]", Code: ']'}),
		w.Update(tea.KeyPressMsg{Text: "]", Code: ']'}),
	)
	view := strings.ToLower(w.View())
	if !strings.Contains(view, "linked cases") || strings.Contains(view, "eval evidence unavailable") {
		t.Fatalf("retried Cases evidence did not settle after navigation:\n%s", view)
	}
}

func TestWorkbenchRefetchesCompletedInsightsEvalEvidenceOnFocus(t *testing.T) {
	client := &delayedInsightsEvalClient{FixtureClient: uitest.NewFixtureClient()}
	w := newTestWorkbench(client, nil, "http://localhost:4400")
	w.Resize(120, 36)
	runWorkbenchCommands(w, w.Init())
	runWorkbenchCommands(w, w.gotoNav("insights"))
	if got := client.calls(); got != 1 {
		t.Fatalf("initial Insights Eval calls = %d, want 1", got)
	}

	runWorkbenchCommands(w, w.gotoNav("overview"))
	runWorkbenchCommands(w, w.gotoNav("insights"))
	if got := client.calls(); got != 2 {
		t.Fatalf("Insights Eval calls after refocus = %d, want 2", got)
	}
}
