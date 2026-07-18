package screens

// CaptureLocation returns Runs' logical pane and stable run/span identities.
// The run list and detail payload remain live screen-owned data.
func (s *Runs) CaptureLocation() ScreenLocation {
	return ScreenLocation{
		FocusedPane: runsPaneID(s.focus),
		SelectedIDs: map[string]string{
			"run":  s.SelectedRunID(),
			"span": s.SelectedSpanID(),
		},
	}
}

// RestoreLocation restores Runs focus and selections against its current
// resource data. Missing identities fall back through the screen's normal
// list/detail reconciliation rather than resurrecting historical payloads.
func (s *Runs) RestoreLocation(location ScreenLocation) {
	if focus, ok := runsFocusByID(location.FocusedPane); ok {
		s.setFocus(focus)
	}
	if id := location.SelectedIDs["run"]; id != "" {
		s.runList.Select(id)
	}
	if id := location.SelectedIDs["span"]; id != "" && s.hasSpan(id) {
		s.syncSpanRows()
		s.spanList.Select(id)
	}
}

func (s *Runs) hasSpan(id string) bool {
	if s.detail == nil {
		return false
	}
	for _, span := range s.detail.Spans {
		if span.ID == id {
			return true
		}
	}
	return false
}

func runsPaneID(focus runsFocus) string {
	switch focus {
	case focusWaterfall:
		return "waterfall"
	case focusSpanDetail:
		return "span-detail"
	default:
		return "runs"
	}
}

func runsFocusByID(id string) (runsFocus, bool) {
	switch id {
	case "runs":
		return focusRuns, true
	case "waterfall":
		return focusWaterfall, true
	case "span-detail":
		return focusSpanDetail, true
	default:
		return focusRuns, false
	}
}
