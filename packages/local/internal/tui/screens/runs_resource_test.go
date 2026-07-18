package screens

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type revisionRunsClient struct {
	*uitest.FixtureClient
}

func (c *revisionRunsClient) ObservabilityRunsPage(context.Context) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{
		Revision: 53,
		Rows: []api.ObservabilityRunSummary{
			{RunID: "run-revisioned", Name: "revisioned run", Revision: 47},
		},
	}, nil
}

func TestRunsListFetchRetainsSummaryRevision(t *testing.T) {
	ctx := context.Background()
	client := &revisionRunsClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()

	cmd := runs.Init(ctx, client)
	if cmd == nil {
		t.Fatal("Runs Init did not schedule a list fetch")
	}
	runs.Update(ctx, cmd(), client)

	snapshot := runs.runsResource.Snapshot()
	if !snapshot.HasValue || len(snapshot.Value) != 1 {
		t.Fatalf("list resource = %#v, want one retained summary", snapshot)
	}
	if got := snapshot.Value[0].Revision; got != 47 {
		t.Fatalf("summary revision = %d, want 47", got)
	}
	if got := snapshot.Token.Revision; got != 53 {
		t.Fatalf("resource revision = %d, want page revision 53", got)
	}
}

type detailRaceClient struct {
	*uitest.FixtureClient
}

func (c *detailRaceClient) ObservabilityRunDetail(_ context.Context, runID string) (api.ObservabilityRunDetail, bool, error) {
	revision := int64(9)
	if runID == "run-a" {
		revision = 91
	}
	return api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: runID, Revision: revision},
		Root: api.ObservabilityRunDetailNode{ID: "span-" + runID},
	}, true, nil
}

func TestRunsDetailRejectsLateResultFromPreviousSelection(t *testing.T) {
	ctx := context.Background()
	client := &detailRaceClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()

	runs.selRun = "run-a"
	requestA := runs.fetchRunDetail(ctx, client, "run-a")
	runs.selRun = "run-b"
	requestB := runs.fetchRunDetail(ctx, client, "run-b")

	runs.Update(ctx, requestB(), client)
	runs.Update(ctx, requestA(), client)

	snapshot := runs.detailResource.Snapshot()
	if !snapshot.HasValue || snapshot.Value.Run.RunID != "run-b" {
		t.Fatalf("detail resource owner = %#v, want run-b", snapshot)
	}
	if runs.detail == nil || runs.detail.Run.TraceID != "run-b" {
		t.Fatalf("rendered detail = %#v, want run-b", runs.detail)
	}
}

func TestRunsDetailRevisionIsScopedToSelectedRun(t *testing.T) {
	ctx := context.Background()
	client := &detailRaceClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()

	runs.selRun = "run-a"
	runs.Update(ctx, runs.fetchRunDetail(ctx, client, "run-a")(), client)
	runs.selRun = "run-b"
	runs.Update(ctx, runs.fetchRunDetail(ctx, client, "run-b")(), client)

	snapshot := runs.detailResource.Snapshot()
	if got := snapshot.Token.Revision; got != 9 {
		t.Fatalf("run-b revision = %d, want its server revision 9", got)
	}
}

func TestRunsDetailRejectsResultOlderThanSelectedSummary(t *testing.T) {
	ctx := context.Background()
	client := &detailRaceClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-b", Revision: 50})
	runs.selRun = "run-b"

	runs.Update(ctx, runs.fetchRunDetail(ctx, client, "run-b")(), client)

	snapshot := runs.detailResource.Snapshot()
	if snapshot.HasValue || runs.detail != nil {
		t.Fatalf("stale detail was retained: resource=%#v view=%#v", snapshot, runs.detail)
	}
}

func TestRunsSameOwnerRefreshKeepsLastGoodDetailVisible(t *testing.T) {
	runs := NewRuns()
	runs.selRun = "run-b"
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-b", Revision: 9},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	})
	previous := runs.detail

	cmd := runs.activateFocus(testContext, &detailRaceClient{FixtureClient: uitest.NewFixtureClient()})

	if cmd == nil {
		t.Fatal("same-owner refresh did not schedule a request")
	}
	if runs.detail != previous || runs.detail == nil {
		t.Fatal("same-owner refresh hid the last-good rendered detail")
	}
	snapshot := runs.detailResource.Snapshot()
	if !snapshot.HasValue || !snapshot.Refreshing {
		t.Fatalf("same-owner refresh state = %#v, want retained refreshing value", snapshot)
	}
}

func TestRunsClearedSelectionRejectsPendingDetail(t *testing.T) {
	ctx := context.Background()
	client := &detailRaceClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Revision: 91})
	runs.selRun = "run-a"
	requestA := runs.fetchRunDetail(ctx, client, "run-a")
	runs.runQuery = "does-not-match"
	runs.ensureFilteredRunSelection(ctx, nil)

	runs.Update(ctx, requestA(), client)

	if runs.selRun != "" {
		t.Fatalf("selection = %q, want cleared", runs.selRun)
	}
	if snapshot := runs.detailResource.Snapshot(); snapshot.HasValue || runs.detail != nil {
		t.Fatalf("cleared selection accepted pending detail: resource=%#v view=%#v", snapshot, runs.detail)
	}
}

func TestRunsNewerListRevisionRefreshesOlderSelectedDetail(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Revision: 5})
	runs.selRun = "run-a"
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-a", Revision: 5},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	})
	previous := runs.detail

	cmd := runs.Update(testContext, runsListLoadedForTest(runs,
		api.ObservabilityRunSummary{RunID: "run-a", Revision: 6},
	), &detailRaceClient{FixtureClient: uitest.NewFixtureClient()})

	if cmd == nil {
		t.Fatal("newer selected summary did not refresh older detail")
	}
	if runs.detail != previous || runs.detail == nil {
		t.Fatal("revision refresh hid the last-good rendered detail")
	}
	snapshot := runs.detailResource.Snapshot()
	if !snapshot.Refreshing || snapshot.Token.Revision != 6 {
		t.Fatalf("detail refresh state = %#v, want revision floor 6", snapshot)
	}
}

func TestRunsRefetchesAfterSameOwnerInitialLoadIsCanceled(t *testing.T) {
	client := &detailRaceClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()
	runs.selRun = "run-a"
	runs.fetchRunDetail(testContext, client, "run-a")
	firstRequest := runs.detailResource.Snapshot().Token.Request

	runs.Focus("run", "run-a")
	cmd := runs.Update(testContext, runsListLoadedForTest(runs,
		api.ObservabilityRunSummary{RunID: "run-a"},
	), client)

	if cmd == nil {
		t.Fatal("list load did not replace the canceled same-owner detail request")
	}
	if got := runs.detailResource.Snapshot().Token.Request; got <= firstRequest {
		t.Fatalf("detail request = %d, want newer than canceled request %d", got, firstRequest)
	}
}
