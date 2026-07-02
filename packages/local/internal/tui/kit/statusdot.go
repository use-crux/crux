package kit

import (
	"image/color"

	"charm.land/lipgloss/v2"
)

// StatusDot renders the colored glyph for run/case statuses:
//
//	pass · fail · warn · new · skip · run
func StatusDot(status string) string {
	var (
		color color.Color
		glyph string
	)
	switch status {
	case "pass", "success", "passed":
		color, glyph = adapterPalette.Green, "●"
	case "fail", "failed", "error", "errored":
		color, glyph = adapterPalette.Red, "●"
	case "warn", "warning":
		color, glyph = adapterPalette.Amber, "▲"
	case "new", "new-fail":
		color, glyph = adapterPalette.Violet, "◆"
	case "run", "running":
		color, glyph = adapterPalette.Teal, "◆"
	case "skip", "skipped":
		color, glyph = adapterPalette.Mut, "○"
	default:
		// Design uses a filled bullet for every status row — only the
		// color changes per status. `·` (middot) was unreadable as a
		// status indicator and inconsistent with the dotted style of
		// the rest of the workbench.
		color, glyph = adapterPalette.Mut, "●"
	}
	return lipgloss.NewStyle().Foreground(color).Render(glyph)
}

// SeverityDot renders the colored bullet used in insights lists.
func SeverityDot(severity string) string {
	return lipgloss.NewStyle().Foreground(SeverityColor(severity)).Render("●")
}

// SeverityColor returns the palette color for an insight severity level.
func SeverityColor(severity string) color.Color {
	switch severity {
	case "high":
		return adapterPalette.Red
	case "medium":
		return adapterPalette.Amber
	default:
		return adapterPalette.Dim
	}
}
