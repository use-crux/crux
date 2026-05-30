// Package shell contains the V1 Panels chrome: terminal-style title bar,
// top tab strip, left nav rail, breadcrumb, status bar, and the generic
// three-pane primitives every Quality screen plugs into.
package shell

import "github.com/charmbracelet/lipgloss"

// Crux dark + teal palette, adapted from packages/devtools design bundle
// (tui-shared.jsx). Keep the pane ladder subtle so borders, not card fills,
// do the structural work like the target terminal design.
var (
	ColorBG           = lipgloss.Color("#0a0c0b")
	ColorPanel        = lipgloss.Color("#0b0d0d")
	ColorPanelAlt     = lipgloss.Color("#101313")
	ColorSurface      = lipgloss.Color("#151919")
	// ColorSelectedNav is a very subtle teal-tinted dark — alpha 0.06
	// of the teal accent on top of the panel base. Used as the nav-rail
	// selected-row background so the active item reads at a glance
	// without the saturated #082b31 "glow" the legacy color produced.
	ColorSelectedNav = lipgloss.Color("#0d1816")
	// ColorBorder is the workhorse hairline color — used for in-pane
	// dividers and vertical pane separators. Pure neutral gray so the
	// hairline doesn't pick up a teal/cyan tint against the (very
	// slightly green-shifted) panel bg.
	//
	// Tuning history:
	//   #343b3b → too prominent + cyan-tinted (G/B higher than R)
	//   #242929 → almost invisible + cyan-tinted
	//   #2d3434 → mid-visibility + cyan-tinted (the "teal border" call-out)
	//   #3a3a3a → mid-visibility, neutral gray  ← current
	ColorBorder = lipgloss.Color("#3a3a3a")
	// ColorBorderBright is the higher-contrast variant — reserved for
	// modal borders where the overlay's edge needs to read distinctly
	// against the body behind it. Also pure neutral gray now.
	ColorBorderBright = lipgloss.Color("#4a4a4a")
	ColorText         = lipgloss.Color("#d5dcd8")
	ColorTextDim      = lipgloss.Color("#8c958f")
	ColorTextMuted    = lipgloss.Color("#636b68")
	ColorTeal         = lipgloss.Color("#5eead4")
	ColorTealDim      = lipgloss.Color("#2dd4bf")
	ColorTealDark     = lipgloss.Color("#0d3f37")
	ColorAmber        = lipgloss.Color("#fbbf24")
	ColorRose         = lipgloss.Color("#fb7185")
	ColorViolet       = lipgloss.Color("#a78bfa")
	ColorGreen        = lipgloss.Color("#86efac")
)

// Style is a thin wrapper around lipgloss that exposes the most common
// pre-configured variants used by the shell + screens. Screens should grab
// these instead of building fresh lipgloss.NewStyle() calls everywhere — keeps
// the visual language consistent and centralized.
var (
	BG         = lipgloss.NewStyle().Background(ColorBG)
	Text       = lipgloss.NewStyle().Foreground(ColorText)
	TextDim    = lipgloss.NewStyle().Foreground(ColorTextDim)
	TextMuted  = lipgloss.NewStyle().Foreground(ColorTextMuted)
	Teal       = lipgloss.NewStyle().Foreground(ColorTeal)
	TealBold   = lipgloss.NewStyle().Foreground(ColorTeal).Bold(true)
	Amber      = lipgloss.NewStyle().Foreground(ColorAmber)
	Rose       = lipgloss.NewStyle().Foreground(ColorRose)
	Violet     = lipgloss.NewStyle().Foreground(ColorViolet)
	Green      = lipgloss.NewStyle().Foreground(ColorGreen)
	Panel      = lipgloss.NewStyle().Background(ColorPanel)
	PanelAlt   = lipgloss.NewStyle().Background(ColorPanelAlt)
	// SectionTag is the small uppercase-grey label used for KPI section
	// titles (`OPEN INSIGHTS`, `PASS RATE`) and detail-pane sections
	// (`IDENTITY`, `TIMING`, `COST`). The design uses thin weight, not
	// bold — bold made the labels compete with the values below them.
	SectionTag = lipgloss.NewStyle().
			Foreground(ColorTextMuted).
			Transform(toUpper)
)

func toUpper(s string) string {
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}

// SeverityColor returns the palette color for an insight severity level.
func SeverityColor(severity string) lipgloss.Color {
	switch severity {
	case "high":
		return ColorRose
	case "medium":
		return ColorAmber
	default:
		return ColorTextDim
	}
}
