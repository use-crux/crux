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
	runs := s.filteredRuns()
	if len(runs) == 0 {
		return nil
	}
	s.runList.SetItems(runs)
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
	s.detail = nil
	return s.fetchRunDetail(ctx, c, selectedID), true
}

func (s *Runs) cycleRunStatusFilter(ctx context.Context, c DataClient) tea.Cmd {
	s.runStatusIndex = (s.runStatusIndex + 1) % (len(runStatusFilters) + 1)
	return s.ensureFilteredRunSelection(ctx, c)
}

func (s *Runs) ensureFilteredRunSelection(ctx context.Context, c DataClient) tea.Cmd {
	previousID := s.SelectedRunID()
	runs := s.filteredRuns()
	s.runList.SetItems(runs)
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
	s.detail = nil
	return s.fetchRunDetail(ctx, c, selectedID)
}

func (s *Runs) clearRunSelection() {
	s.runList.SetItems(nil)
	s.spanList.SetItems(nil)
	s.routedRun = nil
	s.detail = nil
	s.detailResource.Cancel()
}
