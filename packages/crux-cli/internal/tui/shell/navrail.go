package shell

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// NavItem is one row in the left nav rail.
type NavItem struct {
	Key   string // e.g. "1", "2", … "9"
	ID    string // route identifier, e.g. "overview"
	Label string
	Count int  // -1 = no count shown
	Show  bool // when false, the count column is empty
}

// DefaultNav is the V1 quality-tab nav rail. The data layer still uses the
// suites route ID, while the user-facing label stays "Datasets" to match
// the V1 design.
var DefaultNav = []NavItem{
	{Key: "1", ID: "overview", Label: "Overview", Count: -1},
	{Key: "2", ID: "insights", Label: "Insights", Count: 0, Show: true},
	{Key: "3", ID: "runs", Label: "Runs", Count: 0, Show: true},
	{Key: "4", ID: "experiments", Label: "Experiments", Count: 0, Show: true},
	{Key: "5", ID: "compare", Label: "Compare", Count: -1},
	{Key: "6", ID: "suites", Label: "Suites", Count: 0, Show: true},
	{Key: "7", ID: "baselines", Label: "Baselines", Count: 0, Show: true},
	{Key: "8", ID: "feedback", Label: "Feedback", Count: 0, Show: true},
	{Key: "9", ID: "cassettes", Label: "Cassettes", Count: 0, Show: true},
	{Key: "0", ID: "catalog", Label: "Catalog", Count: 0, Show: true},
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

	lines := []string{navLine(" " + tag("WORKBENCH")), navLine(" ")}

	for _, it := range items {
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
	footerLines = append(footerLines, navLine(" "))
	footerLines = append(footerLines, navLine(" "+tag("TARGET")))
	target := footer.TargetID
	if target == "" {
		target = TextMuted.Render("(none)")
	}
	footerLines = append(footerLines, navLine(" "+Text.Render(target)))
	targetParts := make([]string, 0, 2)
	if footer.TargetKind != "" {
		targetParts = append(targetParts, footer.TargetKind)
	}
	if footer.TargetModel != "" {
		targetParts = append(targetParts, footer.TargetModel)
	}
	targetSub := strings.Join(targetParts, " · ")
	if targetSub == "" {
		targetSub = " "
	}
	footerLines = append(footerLines, navLine(" "+TextMuted.Render(targetSub)))
	footerLines = append(footerLines, navLine(" "))
	footerLines = append(footerLines, navLine(" "+tag("BASELINE")))
	bl := footer.BaselineLabel
	if bl == "" {
		bl = TextMuted.Render("(none)")
	}
	footerLines = append(footerLines, navLine(" "+Text.Render(bl)))
	if footer.BaselineRelative != "" {
		footerLines = append(footerLines, navLine(" "+TextMuted.Render(footer.BaselineRelative)))
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
