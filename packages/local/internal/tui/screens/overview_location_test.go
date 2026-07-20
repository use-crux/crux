package screens

import (
	"fmt"
	"reflect"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestOverviewLocationRestoresListAndActivityAnchorsAgainstCurrentData(t *testing.T) {
	overview := NewOverview()
	insights := make([]api.InspectInsightRecord, 20)
	runs := make([]api.InspectRunRecord, 20)
	activity := make([]api.InspectActivityEvent, 20)
	for index := range 20 {
		insights[index] = api.InspectInsightRecord{InsightID: fmt.Sprintf("insight-%02d", index+1)}
		runs[index] = api.InspectRunRecord{TraceID: fmt.Sprintf("run-%02d", index+1)}
		activity[index] = api.InspectActivityEvent{
			Timestamp: int64(100 - index), Kind: "run", RefID: fmt.Sprintf("activity-%02d", index+1),
		}
	}
	setOverviewDataForTest(overview, api.InspectOverviewRecord{}, insights, runs, activity)
	overview.Resize(Size{Width: 70, Height: 24})
	overview.insightList.Update(tea.KeyPressMsg{Code: tea.KeyEnd})
	overview.runList.Update(tea.KeyPressMsg{Code: tea.KeyEnd})
	overview.activityScroll = 11
	overview.setFocusedPanel(panelActivity)
	want := overview.CaptureLocation()

	if want.Anchors["insights"] == "" || want.Anchors["runs"] == "" || want.Anchors["activity"] == "" {
		t.Fatalf("captured Overview anchors are incomplete: %#v", want.Anchors)
	}

	currentInsights := append([]api.InspectInsightRecord{{InsightID: "insight-current"}}, insights...)
	currentRuns := append([]api.InspectRunRecord{{TraceID: "run-current"}}, runs...)
	currentActivity := append([]api.InspectActivityEvent{{Timestamp: 200, Kind: "run", RefID: "activity-current"}}, activity...)
	setOverviewDataForTest(overview, api.InspectOverviewRecord{}, currentInsights, currentRuns, currentActivity)
	overview.insightList.Select("insight-current")
	overview.runList.Select("run-current")
	overview.activityScroll = 0
	overview.setFocusedPanel(panelInsights)

	overview.RestoreLocation(want)
	got := overview.CaptureLocation()
	if got.FocusedPane != want.FocusedPane || !reflect.DeepEqual(got.SelectedIDs, want.SelectedIDs) {
		t.Fatalf("restored Overview identity = %#v, want %#v", got, want)
	}
	if !reflect.DeepEqual(got.Anchors, want.Anchors) {
		t.Fatalf("restored Overview anchors = %#v, want %#v", got.Anchors, want.Anchors)
	}
	if overview.activityRows()[0].RefID != "activity-current" {
		t.Fatal("location restoration replaced current activity data")
	}
}
