package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
)

func (s *Runs) moveDown(ctx context.Context, c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		return s.cycleRun(ctx, c, +1)
	default:
		return s.cycleSpan(+1)
	}
}

func (s *Runs) moveUp(ctx context.Context, c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		return s.cycleRun(ctx, c, -1)
	default:
		return s.cycleSpan(-1)
	}
}

func (s *Runs) cycleRun(ctx context.Context, c DataClient, delta int) tea.Cmd {
	runs := s.filteredRuns()
	if len(runs) == 0 {
		return nil
	}
	s.runList.SetItems(runs)
	s.runList.SetCursorByIdentity(s.selRun)
	if delta > 0 {
		s.runList.CursorDown()
	} else {
		s.runList.CursorUp()
	}
	run, _, ok := s.runList.Cursor()
	if !ok || run.RunID == s.selRun {
		// Cursor didn't move — already at the boundary. No need to
		// re-fetch or rescroll.
		return nil
	}
	s.selRun = run.RunID
	s.detail = nil
	return s.fetchRunDetail(ctx, c, s.selRun)
}

func (s *Runs) cycleRunStatusFilter(ctx context.Context, c DataClient) tea.Cmd {
	s.runStatusIndex = (s.runStatusIndex + 1) % (len(runStatusFilters) + 1)
	return s.ensureFilteredRunSelection(ctx, c)
}

func (s *Runs) ensureFilteredRunSelection(ctx context.Context, c DataClient) tea.Cmd {
	runs := s.filteredRuns()
	s.runList.SetItems(runs)
	if len(runs) == 0 {
		s.selRun = ""
		s.selSpan = ""
		s.detail = nil
		s.detailResource.Cancel()
		return nil
	}
	if s.runList.SetCursorByIdentity(s.selRun) {
		return nil
	}
	s.selRun = runs[0].RunID
	s.runList.SetCursorByIdentity(s.selRun)
	if c == nil {
		return nil
	}
	s.detail = nil
	return s.fetchRunDetail(ctx, c, s.selRun)
}

func (s *Runs) cycleSpan(delta int) tea.Cmd {
	spans := s.visibleSpans()
	if len(spans) == 0 {
		return nil
	}
	idx := 0
	for i, sp := range spans {
		if sp.ID == s.selSpan {
			idx = i
			break
		}
	}
	idx += delta
	if idx < 0 {
		idx = 0
	}
	if idx >= len(spans) {
		idx = len(spans) - 1
	}
	s.selSpan = spans[idx].ID
	return nil
}
