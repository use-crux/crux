package screens

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type overviewRunsErrorClient struct {
	*uitest.FixtureClient
}

type overviewSummaryErrorClient struct {
	*uitest.FixtureClient
}

type overviewActivityClient struct {
	*uitest.FixtureClient
	activity []api.InspectActivityEvent
}

func (c *overviewActivityClient) Activity(context.Context, int) ([]api.InspectActivityEvent, error) {
	return c.activity, nil
}

func (c *overviewSummaryErrorClient) Overview(context.Context) (api.InspectOverviewRecord, error) {
	return api.InspectOverviewRecord{}, errors.New("summary service unavailable")
}

func (c *overviewRunsErrorClient) Runs(context.Context) ([]api.InspectRunRecord, error) {
	return nil, errors.New("runs service unavailable")
}

func TestOverviewRunsRefreshFailureKeepsOtherPanesAndLastGoodRuns(t *testing.T) {
	overview, now := fixtureOverview()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()
	overview.Resize(Size{Width: 100, Height: 30})

	client := &overviewRunsErrorClient{FixtureClient: uitest.NewFixtureClient()}
	msg := overview.fetchRuns(testContext, client)()
	overview.Update(testContext, msg, client)
	view := stripANSI(overview.View(Size{Width: 100, Height: 30}))

	for _, want := range []string{"Top insights", "Recent runs", "degraded", "runs service unavailable"} {
		if !strings.Contains(view, want) {
			t.Fatalf("Overview after runs refresh failure missing %q:\n%s", want, view)
		}
	}
}

func TestOverviewSummaryRefreshFailureShowsDegradedWithLastGoodKPI(t *testing.T) {
	overview, _ := fixtureOverview()
	overview.Resize(Size{Width: 100, Height: 30})
	client := &overviewSummaryErrorClient{FixtureClient: uitest.NewFixtureClient()}

	msg := overview.fetchSummary(testContext, client)()
	overview.Update(testContext, msg, client)
	view := stripANSI(overview.View(Size{Width: 100, Height: 30}))

	for _, want := range []string{"OPEN INSIGHTS", "degraded", "summary service unavailable"} {
		if !strings.Contains(view, want) {
			t.Fatalf("Overview after summary refresh failure missing %q:\n%s", want, view)
		}
	}
}

func TestOverviewEmptySummaryIsDistinctFromReadyZeroMetrics(t *testing.T) {
	overview := NewOverview()
	applyOverviewSummaryForTest(overview, api.InspectOverviewRecord{})
	overview.Resize(Size{Width: 100, Height: 30})

	view := stripANSI(overview.View(Size{Width: 100, Height: 30}))
	if !strings.Contains(view, "no overview summary") {
		t.Fatalf("empty summary did not render its explicit state:\n%s", view)
	}
}

func TestOverviewAcceptedRunsRefreshPreservesStableSelectionAndVisibility(t *testing.T) {
	overview := NewOverview()
	overview.Resize(Size{Width: 100, Height: 30})
	initial := []api.InspectRunRecord{
		{TraceID: "run-a"}, {TraceID: "run-b"}, {TraceID: "run-c"},
		{TraceID: "run-d"}, {TraceID: "run-e"}, {TraceID: "run-f"},
		{TraceID: "run-g"}, {TraceID: "run-h"}, {TraceID: "keep-me", TargetID: "selected-target"},
	}
	applyOverviewRunsForTest(overview, initial)
	overview.setFocusedPanel(panelRuns)
	if !overview.runList.Select("keep-me") {
		t.Fatal("failed to arrange initial stable selection")
	}

	refreshed := []api.InspectRunRecord{
		{TraceID: "run-new"}, {TraceID: "keep-me", TargetID: "selected-target"},
		{TraceID: "run-a"}, {TraceID: "run-b"}, {TraceID: "run-c"},
	}
	_, token := overview.runsResource.Begin(testContext, overviewRunsOwner, 0)
	overview.Update(testContext, runsLoadedMsg(resource.ResourceResult[[]api.InspectRunRecord]{
		Token: token,
		Value: refreshed,
	}), nil)

	if got := overview.SelectedRunID(); got != "keep-me" {
		t.Fatalf("selected run after accepted refresh = %q, want stable ID keep-me", got)
	}
	view := stripANSI(overview.View(Size{Width: 100, Height: 30}))
	if !strings.Contains(view, "keep-me") {
		t.Fatalf("accepted refresh did not keep selected run visible:\n%s", view)
	}
}

func TestOverviewFourResourcesExposeIndependentLoadingAndRefreshing(t *testing.T) {
	overview := NewOverview()
	client := uitest.NewFixtureClient()
	overview.Resize(Size{Width: 100, Height: 30})
	_ = overview.Init(testContext, client)

	loading := stripANSI(overview.View(Size{Width: 100, Height: 30}))
	for _, want := range []string{"loading overview summary", "loading insights", "loading recent runs", "loading activity"} {
		if !strings.Contains(loading, want) {
			t.Fatalf("initial resource state missing %q:\n%s", want, loading)
		}
	}

	overview, _ = fixtureOverview()
	overview.Resize(Size{Width: 100, Height: 30})
	_ = overview.fetchSummary(testContext, client)
	_ = overview.fetchInsights(testContext, client)
	_ = overview.fetchRuns(testContext, client)
	_ = overview.fetchActivity(testContext, client, 12)
	refreshing := stripANSI(overview.View(Size{Width: 100, Height: 30}))
	if got := strings.Count(refreshing, "refreshing"); got < 4 {
		t.Fatalf("refreshing owners rendered %d statuses, want all four:\n%s", got, refreshing)
	}
}

func TestOverviewPaneFailuresDoNotEraseUnrelatedLastGoodData(t *testing.T) {
	overview, _ := fixtureOverview()
	overview.Resize(Size{Width: 100, Height: 30})

	_, insightToken := overview.insightsResource.Begin(testContext, overviewInsightsOwner, 0)
	overview.insightsResource.Apply(resource.ResourceResult[[]api.InspectInsightRecord]{
		Token: insightToken,
		Err:   errors.New("insights down"),
	})
	_, activityToken := overview.activityResource.Begin(testContext, overviewActivityOwner, 0)
	overview.activityResource.Apply(resource.ResourceResult[[]api.InspectActivityEvent]{
		Token: activityToken,
		Err:   errors.New("activity down"),
	})

	view := stripANSI(overview.View(Size{Width: 100, Height: 30}))
	for _, want := range []string{"INS-014", "8af2f1c", "insights down", "activity down"} {
		if !strings.Contains(view, want) {
			t.Fatalf("pane-scoped degraded state missing %q:\n%s", want, view)
		}
	}
}

func TestOverviewRunEventRefreshesStandaloneRunsAuthority(t *testing.T) {
	overview, _ := fixtureOverview()
	overview.Refresh(testContext, uitest.NewFixtureClient(), bridge.Invalidations{
		bridge.OverviewSummaryResource:  1,
		bridge.OverviewRunsResource:     1,
		bridge.OverviewActivityResource: 1,
	})

	if !overview.runsResource.Snapshot().Refreshing {
		t.Fatal("run event did not refresh Overview's standalone runs resource")
	}
	if overview.insightsResource.Snapshot().Refreshing {
		t.Fatal("run event refreshed unrelated insights resource")
	}
}

func TestOverviewNamedRefreshCarriesBridgeProjectionRevisionFloors(t *testing.T) {
	overview, _ := fixtureOverview()
	overview.Refresh(testContext, uitest.NewFixtureClient(), bridge.Invalidations{
		bridge.OverviewSummaryResource:  7,
		bridge.OverviewRunsResource:     5,
		bridge.OverviewActivityResource: 7,
	})

	if got := overview.summaryResource.Snapshot().Token.Revision; got != 7 {
		t.Fatalf("summary revision floor = %d, want 7", got)
	}
	if got := overview.runsResource.Snapshot().Token.Revision; got != 5 {
		t.Fatalf("runs revision floor = %d, want 5", got)
	}
	if got := overview.activityResource.Snapshot().Token.Revision; got != 7 {
		t.Fatalf("activity revision floor = %d, want 7", got)
	}
	if overview.insightsResource.Snapshot().Refreshing {
		t.Fatal("named run refresh started unrelated insights work")
	}
}

func TestOverviewLiveEventBatchDoesNotReplaceActivityRequest(t *testing.T) {
	overview, _ := fixtureOverview()
	before := overview.activityResource.Snapshot().Token.Request

	overview.Update(testContext, LiveEvents{Events: []api.InspectEvent{
		{Timestamp: 1001, Kind: "run", RefID: "run-1"},
		{Timestamp: 1002, Kind: "run", RefID: "run-2"},
		{Timestamp: 1003, Kind: "run", RefID: "run-3"},
	}}, nil)

	if got := overview.activityResource.Snapshot().Token.Request; got != before {
		t.Fatalf("live projection changed activity request from %d to %d", before, got)
	}
}

func TestOverviewAuthoritativeActivityResultSurvivesLiveOverlayAndReconcilesDuplicates(t *testing.T) {
	overview, _ := fixtureOverview()
	client := &overviewActivityClient{
		FixtureClient: uitest.NewFixtureClient(),
		activity: []api.InspectActivityEvent{
			{Kind: "run", RefID: "confirmed", Summary: "confirmed by server"},
			{Kind: "run", RefID: "authoritative", Summary: "authoritative row"},
		},
	}
	pending := overview.fetchActivityAtRevision(testContext, client, 12, 2)
	request := overview.activityResource.Snapshot().Token.Request

	overview.Update(testContext, LiveEvents{Events: []api.InspectEvent{
		{Kind: "run", RefID: "confirmed"},
		{Kind: "run", RefID: "still-pending"},
	}}, client)
	if snapshot := overview.activityResource.Snapshot(); snapshot.Token.Request != request || !snapshot.Refreshing {
		t.Fatalf("live overlay disturbed in-flight activity request: %#v", snapshot)
	}
	overview.Update(testContext, pending(), client)

	rows := overview.projectedActivityRows()
	counts := map[string]int{}
	for _, row := range rows {
		counts[row.RefID]++
	}
	if counts["confirmed"] != 1 || counts["still-pending"] != 1 || counts["authoritative"] != 1 {
		t.Fatalf("reconciled activity counts = %#v, want one confirmed, pending, and authoritative row", counts)
	}
	if snapshot := overview.activityResource.Snapshot(); snapshot.Refreshing || snapshot.Token.Revision != 2 {
		t.Fatalf("authoritative activity result was not accepted: %#v", snapshot)
	}
}
