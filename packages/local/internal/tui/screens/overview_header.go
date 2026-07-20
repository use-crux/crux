package screens

import (
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func overviewPaneHeader(width int, title, subtitle, metadata string) string {
	leftWidth := 1 + lipgloss.Width(title)
	if subtitle != "" {
		leftWidth += 4 + lipgloss.Width(subtitle)
	}
	metadata = kit.Truncate(metadata, max(0, width-leftWidth-2), "…")
	return shell.PaneHeader(width, title, subtitle, shell.TextMuted.Render(metadata))
}
