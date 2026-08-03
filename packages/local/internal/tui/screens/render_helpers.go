package screens

import (
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var codeStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

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
