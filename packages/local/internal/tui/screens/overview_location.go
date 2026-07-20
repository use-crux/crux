package screens

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// CaptureLocation returns Overview's logical pane and stable row identities.
// It intentionally omits the loaded overview, insight, run, and activity data.
func (o *Overview) CaptureLocation() ScreenLocation {
	activityAnchor := ""
	activity := o.projectedActivityRows()
	if o.activityScroll >= 0 && o.activityScroll < len(activity) {
		activityAnchor = overviewActivityLocationID(activity[o.activityScroll])
	}
	return ScreenLocation{
		FocusedPane: overviewPaneID(o.focusedPanel),
		SelectedIDs: map[string]string{
			"insight": o.SelectedInsightID(),
			"run":     o.SelectedRunID(),
		},
		Anchors: map[string]string{
			"insights": o.insightList.Anchor(),
			"runs":     o.runList.Anchor(),
			"activity": activityAnchor,
		},
	}
}

// RestoreLocation restores Overview focus and selections against its current
// resource data. IDs that no longer exist are ignored.
func (o *Overview) RestoreLocation(location ScreenLocation) {
	if panel, ok := overviewPanelByID(location.FocusedPane); ok {
		o.setFocusedPanel(panel)
	}
	if id := location.SelectedIDs["insight"]; id != "" {
		o.insightList.Select(id)
	}
	if id := location.SelectedIDs["run"]; id != "" {
		o.runList.Select(id)
	}
	o.insightList.RestoreAnchor(location.Anchors["insights"])
	o.runList.RestoreAnchor(location.Anchors["runs"])
	if anchor := location.Anchors["activity"]; anchor != "" {
		for index, event := range o.projectedActivityRows() {
			if overviewActivityLocationID(event) == anchor {
				o.activityScroll = index
				break
			}
		}
	}
	o.clampActivityScroll()
}

func overviewActivityLocationID(event api.InspectActivityEvent) string {
	encoded, _ := json.Marshal([3]any{event.Timestamp, event.Kind, event.RefID})
	return string(encoded)
}

func overviewPaneID(panel overviewPanel) string {
	switch panel {
	case panelRuns:
		return "runs"
	case panelActivity:
		return "activity"
	default:
		return "insights"
	}
}

func overviewPanelByID(id string) (overviewPanel, bool) {
	switch id {
	case "insights":
		return panelInsights, true
	case "runs":
		return panelRuns, true
	case "activity":
		return panelActivity, true
	default:
		return panelInsights, false
	}
}
