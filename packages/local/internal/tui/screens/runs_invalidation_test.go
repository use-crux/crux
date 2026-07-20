package screens

import (
	"context"
	"sync"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type cancelingInvalidationClient struct {
	*uitest.FixtureClient
	mu      sync.Mutex
	calls   int
	started chan context.Context
}

func (c *cancelingInvalidationClient) ObservabilityRunsPage(ctx context.Context) (api.ObservabilityRunsPage, error) {
	c.mu.Lock()
	c.calls++
	call := c.calls
	c.mu.Unlock()
	if call == 1 {
		c.started <- ctx
		<-ctx.Done()
		return api.ObservabilityRunsPage{}, ctx.Err()
	}
	return api.ObservabilityRunsPage{
		Revision: 3,
		Rows:     []api.ObservabilityRunSummary{{RunID: "run-new", Revision: 3}},
	}, nil
}

func TestRunsReplacementNamedInvalidationCancelsAndRejectsLateResult(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs)
	client := &cancelingInvalidationClient{
		FixtureClient: uitest.NewFixtureClient(),
		started:       make(chan context.Context, 1),
	}
	first := runs.Refresh(testContext, client, bridge.Invalidations{bridge.RunsListResource: 2})
	firstResult := make(chan tea.Msg, 1)
	go func() { firstResult <- first() }()
	var firstContext context.Context
	select {
	case firstContext = <-client.started:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the first named Runs request")
	}

	second := runs.Refresh(testContext, client, bridge.Invalidations{bridge.RunsListResource: 3})
	select {
	case <-firstContext.Done():
	default:
		t.Fatal("replacement named invalidation did not cancel the first Runs request")
	}
	runs.Update(testContext, second(), client)
	select {
	case result := <-firstResult:
		runs.Update(testContext, result, client)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the canceled Runs result")
	}

	snapshot := runs.runsResource.Snapshot()
	if !snapshot.HasValue || len(snapshot.Value) != 1 || snapshot.Value[0].RunID != "run-new" {
		t.Fatalf("late canceled result replaced current Runs list: %#v", snapshot)
	}
	if snapshot.Token.Revision != 3 {
		t.Fatalf("Runs list revision = %d, want 3", snapshot.Token.Revision)
	}
}

type invalidationRevisionClient struct {
	*uitest.FixtureClient
	revision    int64
	rowRevision int64
	listCalls   int
	detailCalls int
}

func (c *invalidationRevisionClient) ObservabilityRunsPage(context.Context) (api.ObservabilityRunsPage, error) {
	c.listCalls++
	rowRevision := c.rowRevision
	if rowRevision == 0 {
		rowRevision = c.revision
	}
	return api.ObservabilityRunsPage{
		Revision: c.revision,
		Rows:     []api.ObservabilityRunSummary{{RunID: "run-a", Revision: rowRevision}},
	}, nil
}

func (c *invalidationRevisionClient) ObservabilityRunDetail(_ context.Context, runID string) (api.ObservabilityRunDetail, bool, error) {
	c.detailCalls++
	return api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: runID, Revision: c.revision},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	}, true, nil
}

func TestRunsNamedInvalidationRefreshesOnlyTheSelectedExactDetail(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Revision: 5})
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-a", Revision: 5},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	})
	client := &invalidationRevisionClient{FixtureClient: uitest.NewFixtureClient(), revision: 6, rowRevision: 5}

	applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsListResource:            6,
		bridge.RunsDetailResource("run-b"): 6,
	}), client)
	if client.listCalls != 1 || client.detailCalls != 0 {
		t.Fatalf("unrelated exact detail calls = list:%d detail:%d, want 1/0", client.listCalls, client.detailCalls)
	}

	applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsDetailResource("run-a"): 6,
	}), client)
	if client.detailCalls != 1 {
		t.Fatalf("selected exact detail calls = %d, want 1", client.detailCalls)
	}

	applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsAnyDetailResource: 6,
	}), client)
	if client.detailCalls != 2 {
		t.Fatalf("wildcard selected detail calls = %d, want 2", client.detailCalls)
	}
}

func TestRunsNamedInvalidationRejectsResultsBelowServerRevisionFloor(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Revision: 5})
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-a", Revision: 5},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	})
	client := &invalidationRevisionClient{FixtureClient: uitest.NewFixtureClient(), revision: 7}

	applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsListResource:            8,
		bridge.RunsDetailResource("run-a"): 8,
	}), client)

	listSnapshot := runs.runsResource.Snapshot()
	detailSnapshot := runs.detailResource.Snapshot()
	if got := listSnapshot.Token.Revision; got != 8 {
		t.Fatalf("list revision floor after stale result = %d, want 8", got)
	}
	if got := detailSnapshot.Token.Revision; got != 8 {
		t.Fatalf("detail revision floor after stale result = %d, want 8", got)
	}
	if listSnapshot.Value[0].Revision != 5 || detailSnapshot.Value.Run.Revision != 5 {
		t.Fatal("result below the named server revision floor replaced last-good Runs data")
	}
	if listSnapshot.State != resource.ResourceDegraded || listSnapshot.Refreshing || detailSnapshot.State != resource.ResourceDegraded || detailSnapshot.Refreshing {
		t.Fatalf("stale Runs results were not terminal degraded states: list=%#v detail=%#v", listSnapshot, detailSnapshot)
	}
}

func applyRunsBatchForTest(t *testing.T, runs *Runs, cmd tea.Cmd, client DataClient) {
	t.Helper()
	if cmd == nil {
		t.Fatal("expected Runs refresh command")
	}
	msg := cmd()
	if batch, ok := msg.(tea.BatchMsg); ok {
		for _, child := range batch {
			if childMsg := child(); childMsg != nil {
				runs.Update(testContext, childMsg, client)
			}
		}
		return
	}
	if msg != nil {
		runs.Update(testContext, msg, client)
	}
}
