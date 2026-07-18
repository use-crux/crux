package screens

import "github.com/use-crux/crux/packages/local/internal/api"

// ensureSelectedRunVisible represents an exact route target even when it is
// outside the current list page. This keeps the visible cursor consistent
// with the breadcrumb and detail request until the exact detail arrives.
func (s *Runs) ensureSelectedRunVisible() {
	s.routedRun = nil
	if s.selRun == "" || s.hasRun(s.selRun) {
		return
	}
	routed := api.InspectRunRecord{
		Tag:      "InspectRunRecord",
		TraceID:  s.selRun,
		TargetID: s.selRun,
		Status:   "unknown",
	}
	if s.detail != nil && s.detail.Run.TraceID == s.selRun {
		routed = s.detail.Run
	}
	s.routedRun = &routed
}

// replaceSelectedRunSummary swaps the route placeholder for current detail
// metadata without changing its stable list position.
func (s *Runs) replaceSelectedRunSummary(run api.InspectRunRecord) {
	if run.TraceID == "" {
		return
	}
	if s.routedRun != nil && s.routedRun.TraceID == run.TraceID {
		s.routedRun = &run
		s.runList.SetItems(s.filteredRuns())
		s.runList.SetCursorByIdentity(s.selRun)
		return
	}
	for i := range s.runs {
		if s.runs[i].TraceID != run.TraceID {
			continue
		}
		s.runs[i] = run
		s.runList.SetItems(s.runs)
		s.runList.SetCursorByIdentity(s.selRun)
		return
	}
}

func (s *Runs) selectableRuns() []api.InspectRunRecord {
	if s.routedRun == nil {
		return s.runs
	}
	return append([]api.InspectRunRecord{*s.routedRun}, s.runs...)
}

func (s *Runs) hasRun(id string) bool {
	for _, run := range s.runs {
		if run.TraceID == id {
			return true
		}
	}
	return false
}
