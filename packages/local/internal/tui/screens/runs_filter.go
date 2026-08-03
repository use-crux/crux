package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
)

func (s *Runs) updateRunFilter(ctx context.Context, msg tea.KeyPressMsg, c DataClient) tea.Cmd {
	switch msg.String() {
	case "esc", "enter":
		s.filteringRuns = false
	case "backspace":
		if s.filters.Query != "" {
			rs := []rune(s.filters.Query)
			s.filters.Query = string(rs[:len(rs)-1])
		}
	default:
		if msg.Text != "" {
			s.filters.Query += msg.Text
		}
	}
	return s.ensureFilteredRunSelection(ctx, c)
}
