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
		if s.runQuery != "" {
			rs := []rune(s.runQuery)
			s.runQuery = string(rs[:len(rs)-1])
		}
	default:
		if msg.Text != "" {
			s.runQuery += msg.Text
		}
	}
	return s.ensureFilteredRunSelection(ctx, c)
}
