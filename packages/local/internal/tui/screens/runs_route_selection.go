package screens

import (
	"github.com/use-crux/crux/packages/local/internal/api"
)

// ensureSelectedRunVisible represents an exact route target even when it is
// outside the current list page. This keeps the visible cursor consistent
// with the breadcrumb and detail request until the exact detail arrives.
func (s *Runs) ensureSelectedRunVisible() {
	s.routedRun = nil
	if s.selRun == "" || s.hasRun(s.selRun) {
		return
	}
	detailSnapshot := s.detailResource.Snapshot()
	if detailSnapshot.HasValue && detailSnapshot.Value.Run.RunID == s.selRun {
		routed := detailSnapshot.Value.Run
		s.routedRun = &routed
		return
	}
	routed := api.ObservabilityRunSummary{
		RunID:  s.selRun,
		Name:   s.selRun,
		Status: "unknown",
	}
	s.routedRun = &routed
}

// replaceSelectedRunSummary swaps the route placeholder for current detail
// metadata without changing its stable list position.
func (s *Runs) replaceSelectedRunSummary(run api.ObservabilityRunSummary) {
	if run.RunID == "" {
		return
	}
	if s.routedRun != nil && s.routedRun.RunID == run.RunID {
		s.routedRun = &run
		s.runList.SetItems(s.filteredRuns())
		s.runList.SetCursorByIdentity(s.selRun)
	}
}

func (s *Runs) selectableRuns() []api.ObservabilityRunSummary {
	runs := s.runSummaries()
	if s.routedRun == nil {
		return runs
	}
	return append([]api.ObservabilityRunSummary{*s.routedRun}, runs...)
}

func (s *Runs) hasRun(id string) bool {
	for _, run := range s.runSummaries() {
		if run.RunID == id {
			return true
		}
	}
	return false
}

func (s *Runs) runSummaries() []api.ObservabilityRunSummary {
	snapshot := s.runsResource.Snapshot()
	if !snapshot.HasValue {
		return nil
	}
	return snapshot.Value
}

func (s *Runs) selectedRunRevision() uint64 {
	for _, run := range s.selectableRuns() {
		if run.RunID == s.selRun {
			return uint64Revision(run.Revision)
		}
	}
	return 0
}

func (s *Runs) selectedDetailIsCurrent() bool {
	if s.selRun == "" {
		return false
	}
	snapshot := s.detailResource.Snapshot()
	if snapshot.Token.Owner != runsDetailOwner(s.selRun) || snapshot.Token.Revision < s.selectedRunRevision() {
		return false
	}
	if snapshot.HasValue {
		return s.detail != nil && snapshot.Value.Run.RunID == s.selRun
	}
	return false
}
