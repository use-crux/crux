package shell

import (
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

// PaneHeader renders the header strip at the top of a pane:
//
//	Title · 8 open                                 right-meta
//
// Subtle, single-line, single dim divider below. `width` is the pane width.
// `right` is rendered without further styling.
func PaneHeader(width int, title string, subtitle string, right string) string {
	// Title is in regular weight — design uses medium-weight white,
	// not bold. Previously we set Bold(true) which made titles compete
	// visually with the values inside each pane (the actual content
	// is what should draw the eye, not the header).
	mainStyle := lipgloss.NewStyle().Foreground(ColorText)
	muted := lipgloss.NewStyle().Foreground(ColorTextMuted)

	leading := mainStyle.Render(title)
	middle := ""
	if subtitle != "" {
		middle = "  " + muted.Render("· "+subtitle)
	}
	innerWidth := max(0, width-2)
	row := " " + kit.FitMiddle(innerWidth, leading, middle, right, muted.Render("…")) + " "
	// Sandwich the title row with top + bottom dividers so every section
	// header has a clear top boundary regardless of what sits above it
	// in the composition (was: only a bottom rule, leaving stacked
	// sub-panes like "Recent runs" without a visible top edge whenever
	// the composer forgot to add a separator).
	titleRow := lipgloss.NewStyle().Width(width).Render(row)
	return horizontalBorderDim(width) + "\n" +
		titleRow + "\n" +
		horizontalBorderDim(width)
}

// PaneFooter renders the action bar at the bottom of a pane:
//
//	[s] save  [r] run  [c] compare  [p] promote  [x] dismiss
//
// Each key is a small `surface` chip with teal text; the label is dim. The
// strip itself sits on the panel background with a thin dim divider on top
// — matching the design's quiet, non-obstrusive feel.
func PaneFooter(width int, actions []Keybind) string {
	if len(actions) == 0 {
		return ""
	}
	keyChip := lipgloss.NewStyle().
		Background(ColorSurface).
		Foreground(ColorTeal).
		Padding(0, 1).
		MarginRight(1)
	labelStyle := lipgloss.NewStyle().Foreground(ColorTextDim)
	parts := make([]string, 0, len(actions))
	for _, k := range actions {
		parts = append(parts, keyChip.Render(k.Key)+labelStyle.Render(k.Label))
	}
	bar := " " + strings.Join(parts, "  ")
	pad := width - lipgloss.Width(bar)
	if pad > 0 {
		bar += strings.Repeat(" ", pad)
	}
	// No bg fill on the action bar — it sits on the same bg as the
	// pane content above it, separated only by the dim divider. Matches
	// the design's quiet, low-chrome feel.
	return horizontalBorderDim(width) + "\n" +
		lipgloss.NewStyle().Width(width).Render(bar)
}

// SelectionBar renders the 2-col left bar used to mark a selected row.
func SelectionBar(c color.Color) string {
	return lipgloss.NewStyle().Foreground(c).Render("▌")
}

// VBorder returns a vertical 1-column border between panes.
func VBorder(height int) string {
	line := lipgloss.NewStyle().Foreground(ColorBorder).Render("│")
	lines := make([]string, height)
	for i := range lines {
		lines[i] = line
	}
	return strings.Join(lines, "\n")
}

func horizontalBorderDim(width int) string {
	// Use the subtler `ColorBorder` (#242929) instead of the
	// `ColorBorderBright` (#343b3b) the function used to render with.
	// The design's section dividers are barely-there hairlines — the
	// brighter shade was reading as a heavy rule. Foreground-only;
	// the line inherits whichever bg the surrounding content uses.
	return lipgloss.NewStyle().
		Foreground(ColorBorder).
		Render(strings.Repeat("─", width))
}

// horizontalBorder renders a solid border line against the main background.
// (Pulled out of the deleted tabs.go so breadcrumb.go can keep using it.)
func horizontalBorder(width int) string {
	return lipgloss.NewStyle().
		Foreground(ColorBorder).
		Background(ColorBG).
		Render(strings.Repeat("─", width))
}

// HorizontalBorder exposes the shared pane rule for layout seams.
func HorizontalBorder(width int) string {
	return horizontalBorder(width)
}
