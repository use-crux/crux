package overlays

import (
	"strings"

	"charm.land/lipgloss/v2"
)

func fitToWidth(s string, width int) string {
	if width <= 0 {
		return ""
	}
	if lipgloss.Width(s) > width {
		s = lipgloss.NewStyle().MaxWidth(width).Render(s)
	}
	if got := lipgloss.Width(s); got < width {
		return s + strings.Repeat(" ", width-got)
	}
	return s
}
