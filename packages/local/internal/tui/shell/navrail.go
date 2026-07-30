package shell

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
)

// LogoMark is the Crux brand glyph (a diamond) shown at the top of the
// nav rail next to the "Crux" wordmark.
const LogoMark = "◇"

// NavItem is one row in the left nav rail.
type NavItem struct {
	Key   string // e.g. "1", "2", … "9"
	ID    string // route identifier, e.g. "overview"
	Label string
	Group string // section heading this item sits under (e.g. "Inspect")
	Count int    // -1 = no count shown
	Show  bool   // when false, the count column is empty
}

// DefaultNav is the local inspection nav rail.
//
// Numeric workspace actions are derived from this order. The web nav's extra
// Library entries (Memory, Workspaces, Plans & Tasks) and the pinned
// "Scorers & gates" item have no TUI screen yet, so they are intentionally
// omitted rather than rendered as dead rows.
var DefaultNav = []NavItem{
	{Key: "1", ID: "overview", Label: "Overview", Group: "Inspect", Count: -1},
	{Key: "2", ID: "insights", Label: "Insights", Group: "Inspect", Count: 0, Show: true},
	{Key: "3", ID: "runs", Label: "Runs", Group: "Inspect", Count: 0, Show: true},
	{Key: "4", ID: "index", Label: "Index", Group: "Library", Count: 0, Show: true},
}

// NavRailFooter is rendered under the nav rail (target + baseline blocks).
type NavRailFooter struct {
	TargetID         string
	TargetKind       string
	TargetModel      string
	BaselineLabel    string
	BaselineRelative string // e.g. "3d ago"
}

// NavRailWidth is the fixed column width used by the V1 design.
const NavRailWidth = 18

// NavRail renders the left rail. `height` is total available rows.
// `active` is the active nav ID.
func NavRail(height int, items []NavItem, active string, footer NavRailFooter) string {
	tag := lipgloss.NewStyle().
		Foreground(ColorTextMuted).
		Bold(true).
		Render

	// Brand mark: teal diamond + "Crux" wordmark, replacing the old
	// "WORKBENCH" tag. Mirrors the web devtools sidebar logo.
	mark := lipgloss.NewStyle().Foreground(ColorTeal).Bold(true).Render(LogoMark)
	brand := lipgloss.NewStyle().Foreground(ColorText).Bold(true).Render("Crux")
	lines := []string{navLine(" " + mark + " " + brand), navLine(" ")}

	group := ""
	for _, it := range items {
		// Render a section heading whenever the group changes. The blank
		// line after the logo separates the first group; later groups get
		// their own leading blank.
		if it.Group != group {
			group = it.Group
			if len(lines) > 2 {
				lines = append(lines, navLine(" "))
			}
			lines = append(lines, navLine(" "+tag(strings.ToUpper(group))))
		}

		sel := it.ID == active
		key := lipgloss.NewStyle().Foreground(ColorTextMuted).Render(it.Key)
		labelColor := ColorText
		bar := " "
		if sel {
			labelColor = ColorTeal
			bar = lipgloss.NewStyle().Foreground(ColorTeal).Render("▏")
		}
		label := lipgloss.NewStyle().Foreground(labelColor).Bold(sel).Render(it.Label)

		row := fmt.Sprintf("%s %s  %s", bar, key, label)
		if it.Show && it.Count > 0 {
			countColor := ColorTextMuted
			if sel {
				countColor = ColorTeal
			}
			countStr := lipgloss.NewStyle().Foreground(countColor).Render(fmt.Sprintf("%d", it.Count))
			row = padLine(NavRailWidth-lipgloss.Width(countStr)-1, row) + countStr
		} else {
			row = padLine(NavRailWidth, row)
		}
		if sel {
			// Subtle teal-tinted tint behind the entire row — sits just
			// above the rail's panel bg so the selection reads at a
			// glance without becoming a "glow." The earlier saturated
			// `#082b31` was too bright; this is closer to the design's
			// near-imperceptible row tint. Approximates the design's
			// rgba(94,234,212,.06) overlay on the panel bg.
			row = lipgloss.NewStyle().
				Background(ColorSelectedNav).
				Width(NavRailWidth).
				Render(row)
		}
		lines = append(lines, row)
	}

	footerLines := make([]string, 0, 7)
	if footer.TargetID != "" {
		footerLines = append(footerLines, navLine(" "))
		footerLines = append(footerLines, navLine(" "+tag("TARGET")))
		footerLines = append(footerLines, navLine(" "+Text.Render(footer.TargetID)))
		targetParts := make([]string, 0, 2)
		if footer.TargetKind != "" {
			targetParts = append(targetParts, footer.TargetKind)
		}
		if footer.TargetModel != "" {
			targetParts = append(targetParts, footer.TargetModel)
		}
		if len(targetParts) > 0 {
			footerLines = append(footerLines, navLine(" "+TextMuted.Render(strings.Join(targetParts, " · "))))
		}
	}
	if footer.BaselineLabel != "" {
		footerLines = append(footerLines, navLine(" "))
		footerLines = append(footerLines, navLine(" "+tag("BASELINE")))
		footerLines = append(footerLines, navLine(" "+Text.Render(footer.BaselineLabel)))
		if footer.BaselineRelative != "" {
			footerLines = append(footerLines, navLine(" "+TextMuted.Render(footer.BaselineRelative)))
		}
	}

	spacerRows := height - len(lines) - len(footerLines)
	if spacerRows < 1 {
		spacerRows = 1
	}
	for i := 0; i < spacerRows; i++ {
		lines = append(lines, navLine(" "))
	}
	lines = append(lines, footerLines...)
	if len(lines) > height {
		lines = lines[:height]
	}
	rendered := strings.Join(lines, "\n")

	return lipgloss.NewStyle().
		Background(ColorPanel).
		Width(NavRailWidth).
		Render(rendered)
}

func navLine(s string) string {
	return padLine(NavRailWidth, s)
}

func padLine(width int, s string) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}
