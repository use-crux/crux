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

	selectRunForTest(runs, "run-a")
	requestA := runs.fetchRunDetail(ctx, client, "run-a")
	selectRunForTest(runs, "run-b")
	requestB := runs.fetchRunDetail(ctx, client, "run-b")

	runs.Update(ctx, requestB(), client)
	runs.Update(ctx, requestA(), client)

	snapshot := runs.detailResource.Snapshot()
	if !snapshot.HasValue || snapshot.Value.Run.RunID != "run-b" {
		t.Fatalf("detail resource owner = %#v, want run-b", snapshot)
	}
	if runs.diagnosis == nil || runs.diagnosis.Summary.RunID != "run-b" {
		t.Fatalf("rendered diagnosis = %#v, want run-b", runs.diagnosis)
	}
}

func TestRunsDetailRevisionIsScopedToSelectedRun(t *testing.T) {
	ctx := context.Background()
	client := &detailRaceClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()

	selectRunForTest(runs, "run-a")
	runs.Update(ctx, runs.fetchRunDetail(ctx, client, "run-a")(), client)
	selectRunForTest(runs, "run-b")
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
	selectRunForTest(runs, "run-b")

	runs.Update(ctx, runs.fetchRunDetail(ctx, client, "run-b")(), client)

	snapshot := runs.detailResource.Snapshot()
	if snapshot.HasValue || runs.diagnosis != nil {
		t.Fatalf("stale detail was retained: resource=%#v view=%#v", snapshot, runs.diagnosis)
	}
}

func TestRunsSameOwnerRefreshKeepsLastGoodDetailVisible(t *testing.T) {
	runs := NewRuns()
	selectRunForTest(runs, "run-b")
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-b", Revision: 9},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	})
	previous := runs.diagnosis

	cmd := runs.activateFocus(testContext, &detailRaceClient{FixtureClient: uitest.NewFixtureClient()})

	if cmd == nil {
		t.Fatal("same-owner refresh did not schedule a request")
	}
	if runs.diagnosis != previous || runs.diagnosis == nil {
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
	selectRunForTest(runs, "run-a")
	requestA := runs.fetchRunDetail(ctx, client, "run-a")
	runs.runQuery = "does-not-match"
	runs.ensureFilteredRunSelection(ctx, nil)

	runs.Update(ctx, requestA(), client)

	if got := runs.SelectedRunID(); got != "" {
		t.Fatalf("selection = %q, want cleared", got)
	}
	if snapshot := runs.detailResource.Snapshot(); snapshot.HasValue || runs.diagnosis != nil {
		t.Fatalf("cleared selection accepted pending detail: resource=%#v view=%#v", snapshot, runs.diagnosis)
	}
}

func TestRunsRefreshToEmptyFilterClearsAndCancelsSelection(t *testing.T) {
	ctx := context.Background()
	client := &detailRaceClient{FixtureClient: uitest.NewFixtureClient()}
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Name: "visible", Revision: 91})
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-a", Name: "visible", Revision: 91},
		Root: api.ObservabilityRunDetailNode{ID: "span-run-a"},
	})
	selectSpanForTest(runs, "span-run-a")
	pending := runs.fetchRunDetail(ctx, client, "run-a")
	runs.runQuery = "visible"

	runs.Update(ctx, runsListLoadedForTest(runs,
		api.ObservabilityRunSummary{RunID: "run-a", Name: "hidden", Revision: 92},
	), client)
	runs.Update(ctx, pending(), client)

	if selectedID := runs.SelectedRunID(); selectedID != "" || runs.SelectedSpanID() != "" || runs.diagnosis != nil {
		t.Fatalf("empty filtered refresh retained selection/detail: run=%q span=%q detail=%#v", selectedID, runs.SelectedSpanID(), runs.diagnosis)
	}
	if snapshot := runs.detailResource.Snapshot(); snapshot.Refreshing {
		t.Fatalf("empty filtered refresh left detail request active: %#v", snapshot)
	}
}

func TestRunsRoutedDetailMetadataReconcilesActiveFilter(t *testing.T) {
	detail := api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "routed", Name: "resolved", Status: "ok"},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	}

	t.Run("clears when no rows remain", func(t *testing.T) {
		runs := NewRuns()
		runs.Focus("run", "routed")
		runs.runQuery = "unknown"
		runs.ensureFilteredRunSelection(testContext, nil)

		runs.Update(testContext, runDetailLoadedForTest(runs, detail), nil)

		if selectedID := runs.SelectedRunID(); selectedID != "" || runs.diagnosis != nil {
			t.Fatalf("resolved route retained filtered selection/detail: run=%q detail=%#v", selectedID, runs.diagnosis)
		}
	})

	t.Run("loads deterministic neighbor", func(t *testing.T) {
		client := &detailRaceClient{FixtureClient: uitest.NewFixtureClient()}
		runs := NewRuns()
		setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "neighbor", Status: "unknown"})
		runs.Focus("run", "routed")
		runs.runQuery = "unknown"
		runs.ensureFilteredRunSelection(testContext, nil)

		cmd := runs.Update(testContext, runDetailLoadedForTest(runs, detail), client)

		if got := runs.SelectedRunID(); got != "neighbor" {
			t.Fatalf("resolved route selected %q, want neighbor", got)
		}
		if runs.diagnosis != nil {
			t.Fatalf("resolved route retained stale detail: %#v", runs.diagnosis)
		}
		if cmd == nil {
			t.Fatal("resolved route did not schedule neighbor detail fetch")
		}
	})
}

func TestRunsNewerListRevisionRefreshesOlderSelectedDetail(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Revision: 5})
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-a", Revision: 5},
		Root: api.ObservabilityRunDetailNode{ID: "root"},
	})
	previous := runs.diagnosis

	cmd := runs.Update(testContext, runsListLoadedForTest(runs,
		api.ObservabilityRunSummary{RunID: "run-a", Revision: 6},
	), &detailRaceClient{FixtureClient: uitest.NewFixtureClient()})

	if cmd == nil {
		t.Fatal("newer selected summary did not refresh older detail")
	}
	if runs.diagnosis != previous || runs.diagnosis == nil {
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
	selectRunForTest(runs, "run-a")
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
