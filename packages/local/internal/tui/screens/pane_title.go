package screens

import (
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// focusTitle makes the pane that owns keyboard input visually explicit.
func focusTitle(title string, focused bool) string {
	if !focused {
		return title
	}
	return lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▸ ") +
		lipgloss.NewStyle().Foreground(shell.ColorTeal).Bold(true).Render(title)
}
