package screens

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func TestOverviewViewDoesNotMutatePaneState(t *testing.T) {
	overview := NewOverview()
	applyOverviewInsightsForTest(overview, []api.InspectInsightRecord{
		{InsightID: "insight-a"}, {InsightID: "insight-b"}, {InsightID: "insight-c"},
	})
	applyOverviewRunsForTest(overview, []api.InspectRunRecord{
		{TraceID: "run-a"}, {TraceID: "run-b"}, {TraceID: "run-c"},
	})
	overview.Resize(Size{Width: 100, Height: 30})
	overview.insightList.Update(tea.KeyPressMsg{Text: "j", Code: 'j'})

	wantInsights := overview.insightList.Position()
	wantRuns := overview.runList.Position()
	wantActivity := overview.activityScroll
	_ = overview.View(Size{Width: 100, Height: 30})
	_ = overview.View(Size{Width: 100, Height: 30})

	if got := overview.insightList.Position(); !reflect.DeepEqual(got, wantInsights) {
		t.Fatalf("insight pane mutated during render: got %#v, want %#v", got, wantInsights)
	}
	if got := overview.runList.Position(); !reflect.DeepEqual(got, wantRuns) {
		t.Fatalf("run pane mutated during render: got %#v, want %#v", got, wantRuns)
	}
	if overview.activityScroll != wantActivity {
		t.Fatalf("activity offset mutated during render: got %d, want %d", overview.activityScroll, wantActivity)
	}
}

func TestOverviewNarrowLayoutShowsFocusedSelectedRow(t *testing.T) {
	overview := NewOverview()
	runs := make([]api.InspectRunRecord, 20)
	for i := range runs {
		runs[i] = api.InspectRunRecord{TraceID: fmt.Sprintf("narrow-%02d", i+1), TargetID: "narrow-target"}
	}
	runs[len(runs)-1].TargetID = "selected-last"
	applyOverviewRunsForTest(overview, runs)
	overview.Resize(Size{Width: 70, Height: 24})
	overview.setFocusedPanel(panelRuns)
	overview.updateFocusedPane(tea.KeyPressMsg{Code: tea.KeyEnd})

	view := stripANSI(overview.View(Size{Width: 70, Height: 24}))
	for _, want := range []string{"▸ Recent runs", "selected-last"} {
		if !strings.Contains(view, want) {
			t.Fatalf("narrow focused pane missing %q:\n%s", want, view)
		}
	}
}

func TestOverviewActivityPageMovesOnePreparedViewport(t *testing.T) {
	overview := NewOverview()
	activity := make([]api.InspectActivityEvent, 30)
	for i := range activity {
		activity[i] = api.InspectActivityEvent{Timestamp: int64(30 - i), Kind: "run", RefID: fmt.Sprintf("event-%02d", i)}
	}
	applyOverviewActivityForTest(overview, activity)
	overview.Resize(Size{Width: 100, Height: 30})
	overview.setFocusedPanel(panelActivity)

	overview.updateFocusedPane(tea.KeyPressMsg{Code: tea.KeyPgDown})
	if got := overview.activityScroll; got != overview.activityPage || got <= 1 {
		t.Fatalf("activity page down offset = %d, want prepared viewport page %d", got, overview.activityPage)
	}
	overview.updateFocusedPane(tea.KeyPressMsg{Text: "j", Code: 'j'})
	if got := overview.activityScroll; got != overview.activityPage+1 {
		t.Fatalf("activity line movement after page = %d, want %d", got, overview.activityPage+1)
	}
}

func TestOverviewCompactLongDegradedMetadataStaysWithinExactBounds(t *testing.T) {
	overview, _ := fixtureOverview()
	overview.Resize(Size{Width: 70, Height: 24})
	longFailure := errors.New("\x1b[31mupstream unavailable\x1b[0m\n\x1b]8;;https://example.invalid\x07unsafe · " +
		strings.Repeat("activity and summary unavailable · ", 8))

	_, summaryToken := overview.summaryResource.Begin(testContext, overviewSummaryOwner, 0)
	overview.summaryResource.Apply(resource.ResourceResult[api.InspectOverviewRecord]{Token: summaryToken, Err: longFailure})
	_, activityToken := overview.activityResource.Begin(testContext, overviewActivityOwner, 0)
	overview.activityResource.Apply(resource.ResourceResult[[]api.InspectActivityEvent]{Token: activityToken, Err: longFailure})
	overview.setFocusedPanel(panelActivity)

	view := overview.View(Size{Width: 70, Height: 24})
	if strings.Contains(view, "\x1b]8;;https://example.invalid") {
		t.Fatalf("compact degraded view retained an authored OSC sequence:\n%s", view)
	}
	lines := strings.Split(view, "\n")
	if len(lines) != 24 {
		t.Fatalf("compact degraded view height = %d, want 24", len(lines))
	}
	for index, line := range lines {
		if got := lipgloss.Width(line); got != 70 {
			t.Fatalf("compact degraded line %d width = %d, want 70:\n%s", index+1, got, view)
		}
	}
	plain := stripANSI(view)
	for _, want := range []string{"Activity", "…"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("compact degraded view missing bounded metadata cue %q:\n%s", want, plain)
		}
	}
}

func TestOverviewActivityNavigationAndLiveLatchShareVisibleProjection(t *testing.T) {
	overview := NewOverview()
	activity := []api.InspectActivityEvent{
		{Timestamp: 12, Kind: "run", RefID: "event-00", Summary: "event 00"},
		{Timestamp: 11, Kind: "run", RefID: "event-00", Summary: "event 00 duplicate"},
		{Timestamp: 10, Kind: "stream:start", RefID: "noise", Summary: "stream:start noise"},
	}
	for i := 1; i < 10; i++ {
		activity = append(activity, api.InspectActivityEvent{
			Timestamp: int64(10 - i), Kind: "run", RefID: fmt.Sprintf("event-%02d", i), Summary: fmt.Sprintf("event %02d", i),
		})
	}
	applyOverviewActivityForTest(overview, activity)
	overview.Resize(Size{Width: 100, Height: 30})
	overview.setFocusedPanel(panelActivity)

	overview.updateFocusedPane(tea.KeyPressMsg{Code: tea.KeyEnd})
	if got := overview.activityScroll; got != 9 {
		t.Fatalf("activity End offset = %d, want last of 10 visible rows", got)
	}
	overview.updateFocusedPane(tea.KeyPressMsg{Text: "k", Code: 'k'})
	if got := overview.activityScroll; got != 8 {
		t.Fatalf("activity Up offset = %d, want 8", got)
	}
	overview.updateFocusedPane(tea.KeyPressMsg{Code: tea.KeyPgUp})
	if got := overview.activityScroll; got != max(0, 8-overview.activityPage) {
		t.Fatalf("activity PageUp offset = %d, want one visible page", got)
	}

	overview.updateFocusedPane(tea.KeyPressMsg{Code: tea.KeyEnd})
	overview.updateFocusedPane(tea.KeyPressMsg{Text: "k", Code: 'k'})
	latched := overview.activityScroll
	overview.Update(testContext, LiveEvents{Events: []api.InspectEvent{{Kind: "stream:start", RefID: "new-noise"}}}, nil)
	if got := overview.activityScroll; got != latched {
		t.Fatalf("noise event moved activity latch from %d to %d", latched, got)
	}
	overview.Update(testContext, LiveEvents{Events: []api.InspectEvent{{Kind: "run", RefID: "event-00"}}}, nil)
	if got := overview.activityScroll; got != latched {
		t.Fatalf("adjacent duplicate moved activity latch from %d to %d", latched, got)
	}
	overview.Update(testContext, LiveEvents{Events: []api.InspectEvent{{Kind: "run", RefID: "fresh"}}}, nil)
	if got := overview.activityScroll; got != latched+1 {
		t.Fatalf("new visible event moved activity latch to %d, want %d", got, latched+1)
	}
}

func TestOverviewCompactEmptyListsReportZeroOfZero(t *testing.T) {
	overview := NewOverview()
	overview.Resize(Size{Width: 70, Height: 24})

	insights := stripANSI(overview.View(Size{Width: 70, Height: 24}))
	if !strings.Contains(insights, "insight 0/0") {
		t.Fatalf("empty insight position was not 0/0:\n%s", insights)
	}
	overview.setFocusedPanel(panelRuns)
	runs := stripANSI(overview.View(Size{Width: 70, Height: 24}))
	if !strings.Contains(runs, "run 0/0") {
		t.Fatalf("empty run position was not 0/0:\n%s", runs)
	}
}
