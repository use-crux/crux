package screens

import (
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func boxedPre(text string, width int) string {
	style := lipgloss.NewStyle().
		Background(shell.ColorPanel).
		Foreground(shell.ColorText).
		Padding(0, 1).
		Width(width)
	return style.Render(text)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
