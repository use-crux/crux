package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
)

func (s *Runs) moveDown(ctx context.Context, c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		return s.cycleRun(ctx, c, +1)
	case focusWaterfall:
		cmd, _ := s.updateSpanListInput(tea.KeyPressMsg{Text: "j", Code: 'j'})
		return cmd
	case focusSpanDetail:
		cmd, _ := s.updateSpanDocumentInput(tea.KeyPressMsg{Text: "j", Code: 'j'})
		return cmd
	}
	return nil
}

func (s *Runs) moveUp(ctx context.Context, c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		return s.cycleRun(ctx, c, -1)
	case focusWaterfall:
		cmd, _ := s.updateSpanListInput(tea.KeyPressMsg{Text: "k", Code: 'k'})
		return cmd
	case focusSpanDetail:
		cmd, _ := s.updateSpanDocumentInput(tea.KeyPressMsg{Text: "k", Code: 'k'})
		return cmd
	}
	return nil
}

func (s *Runs) updateFocusedPaneInput(ctx context.Context, msg tea.Msg, c DataClient) (tea.Cmd, bool) {
	switch s.focus {
	case focusRuns:
		return s.updateRunListInput(ctx, msg, c)
	case focusWaterfall:
		return s.updateSpanListInput(msg)
	case focusSpanDetail:
		return s.updateSpanDocumentInput(msg)
	default:
		return nil, false
	}
}

func (s *Runs) updateSpanListInput(msg tea.Msg) (tea.Cmd, bool) {
	s.spanList.SetFocused(s.focus == focusWaterfall)
	if !s.spanList.Update(msg) {
		return nil, false
	}
	return nil, true
}

func (s *Runs) updateSpanDocumentInput(msg tea.Msg) (tea.Cmd, bool) {
	s.spanDocument.SetFocused(s.focus == focusSpanDetail)
	if !s.spanDocument.Update(msg) {
		return nil, false
	}
	return nil, true
}

func (s *Runs) cycleRun(ctx context.Context, c DataClient, delta int) tea.Cmd {
	if len(s.filteredRuns()) == 0 {
		return nil
	}
	var msg tea.KeyPressMsg
	if delta > 0 {
		msg = tea.KeyPressMsg{Text: "j", Code: 'j'}
	} else {
		msg = tea.KeyPressMsg{Text: "k", Code: 'k'}
	}
	cmd, _ := s.updateRunListInput(ctx, msg, c)
	return cmd
}

func (s *Runs) updateRunListInput(ctx context.Context, msg tea.Msg, c DataClient) (tea.Cmd, bool) {
	s.runList.SetFocused(s.focus == focusRuns)
	previousID := s.SelectedRunID()
	if !s.runList.Update(msg) {
		return nil, false
	}
	selectedID := s.SelectedRunID()
	if selectedID == "" || selectedID == previousID {
		return nil, true
	}
	s.diagnosis = nil
	return s.scheduleRunDetail(selectedID), true
}

func (s *Runs) cycleRunStatusFilter(ctx context.Context, c DataClient) tea.Cmd {
	s.runStatusIndex = (s.runStatusIndex + 1) % len(runStatusFilters)
	return s.refreshFilteredRuns(ctx, c)
}

func (s *Runs) cycleRunWindow(ctx context.Context, c DataClient) tea.Cmd {
	s.runWindowIndex = (s.runWindowIndex + 1) % len(runWindows)
	return s.refreshFilteredRuns(ctx, c)
}

func (s *Runs) cycleRunGroup(ctx context.Context, c DataClient) tea.Cmd {
	selectedID := s.SelectedRunID()
	s.runGroupIndex = (s.runGroupIndex + 1) % len(runGroups)
	s.syncVisibleRuns()
	if selectedID != "" {
		s.runList.Select(selectedID)
	}
	if s.activeRunGroup().label == "session" {
		return fetchRunsSessions(ctx, c)
	}
	return nil
}

func (s *Runs) cycleRunModel(ctx context.Context, c DataClient) tea.Cmd {
	if len(s.knownModels) == 0 {
		return nil
	}
	if s.modelFilter == "" {
		s.modelFilter = s.knownModels[0]
	} else {
		next := 0
		for index, model := range s.knownModels {
			if model == s.modelFilter {
				next = index + 1
				break
			}
		}
		if next < len(s.knownModels) {
			s.modelFilter = s.knownModels[next]
		} else {
			s.modelFilter = ""
		}
	}
	return s.refreshFilteredRuns(ctx, c)
}

func (s *Runs) toggleSelectedSessionFilter(ctx context.Context, c DataClient) tea.Cmd {
	if s.sessionFilter != "" {
		s.sessionFilter = ""
		return s.refreshFilteredRuns(ctx, c)
	}
	selected, _, ok := s.runList.Selected()
	if !ok || selected.SessionID == "" {
		return nil
	}
	s.sessionFilter = selected.SessionID
	return s.refreshFilteredRuns(ctx, c)
}

func (s *Runs) refreshFilteredRuns(ctx context.Context, c DataClient) tea.Cmd {
	local := s.ensureFilteredRunSelection(ctx, c)
	if c == nil {
		return local
	}
	return tea.Batch(local, s.fetchRunsList(ctx, c))
}

func (s *Runs) ensureFilteredRunSelection(ctx context.Context, c DataClient) tea.Cmd {
	previousID := s.SelectedRunID()
	runs := s.syncVisibleRuns()
	if len(runs) == 0 {
		s.clearRunSelection()
		return nil
	}
	selectedID := s.SelectedRunID()
	if selectedID == previousID {
		return nil
	}
	if selectedID == "" {
		return nil
	}
	if c == nil {
		return nil
	}
	s.diagnosis = nil
	return s.scheduleRunDetail(selectedID)
}

func (s *Runs) clearRunSelection() {
	s.detailIntent++
	s.runList.SetItems(nil)
	s.spanList.SetItems(nil)
	s.routedRun = nil
	s.pendingLocation = nil
	s.diagnosis = nil
	s.detailResource.Cancel()
}
