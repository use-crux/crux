package screens

// CaptureLocation returns Overview's logical pane and stable row identities.
// It intentionally omits the loaded overview, insight, run, and activity data.
func (o *Overview) CaptureLocation() ScreenLocation {
	return ScreenLocation{
		FocusedPane: overviewPaneID(o.focusedPanel),
		SelectedIDs: map[string]string{
			"insight": o.SelectedInsightID(),
			"run":     o.SelectedRunID(),
		},
	}
}

// RestoreLocation restores Overview focus and selections against its current
// resource data. IDs that no longer exist are ignored.
func (o *Overview) RestoreLocation(location ScreenLocation) {
	if panel, ok := overviewPanelByID(location.FocusedPane); ok {
		o.focusedPanel = panel
	}
	if id := location.SelectedIDs["insight"]; id != "" {
		for i := range o.insights {
			if o.insights[i].InsightID == id {
				o.insightCur = i
				break
			}
		}
	}
	if id := location.SelectedIDs["run"]; id != "" {
		for i, run := range o.recentRunsList() {
			if run.TraceID == id {
				o.runCur = i
				break
			}
		}
	}
	o.syncLists()
	o.bumpRenderRev()
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
