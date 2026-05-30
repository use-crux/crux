package components

import (
	"github.com/anthropics/crux-cli/internal/tui/shell"
	"github.com/charmbracelet/lipgloss"
)

// StatusDot renders the colored glyph for run/case statuses:
//
//	pass · fail · warn · new · skip · run
func StatusDot(status string) string {
	var (
		color lipgloss.Color
		glyph string
	)
	switch status {
	case "pass", "success", "passed":
		color, glyph = shell.ColorGreen, "●"
	case "fail", "failed", "error", "errored":
		color, glyph = shell.ColorRose, "●"
	case "warn", "warning":
		color, glyph = shell.ColorAmber, "●"
	case "new", "new-fail":
		color, glyph = shell.ColorViolet, "◆"
	case "run", "running":
		color, glyph = shell.ColorTeal, "◐"
	case "skip", "skipped":
		color, glyph = shell.ColorTextMuted, "○"
	default:
		// Design uses a filled bullet for every status row — only the
		// color changes per status. `·` (middot) was unreadable as a
		// status indicator and inconsistent with the dotted style of
		// the rest of the workbench.
		color, glyph = shell.ColorTextMuted, "●"
	}
	return lipgloss.NewStyle().Foreground(color).Render(glyph)
}

// SeverityDot renders the colored bullet used in insights lists.
func SeverityDot(severity string) string {
	return lipgloss.NewStyle().Foreground(shell.SeverityColor(severity)).Render("●")
}
