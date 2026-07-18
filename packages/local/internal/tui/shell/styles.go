// Package shell contains the V1 Panels chrome: terminal-style title bar,
// top tab strip, left nav rail, breadcrumb, status bar, and the generic
// three-pane primitives every Devtools screen plugs into.
package shell

import (
	"image/color"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

// Crux dark + teal palette, adapted from packages/devtools design bundle
// (tui-shared.jsx). Keep the pane ladder subtle so borders, not card fills,
// do the structural work like the target terminal design.
var (
	shellPalette = theme.Resolve(colorprofile.TrueColor)

	ColorBG       = shellPalette.Bg
	ColorPanel    = shellPalette.Bg
	ColorPanelAlt = shellPalette.Bg2
	ColorSurface  = shellPalette.Bg2
	// ColorSelectedNav is a very subtle teal-tinted dark — alpha 0.06
	// of the teal accent on top of the panel base. Used as the nav-rail
	// selected-row background so the active item reads at a glance
	// without the saturated #082b31 "glow" the legacy color produced.
	ColorSelectedNav = shellPalette.SelBg
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
	ColorBorder = shellPalette.Border
	// ColorBorderBright is the higher-contrast variant — reserved for
	// modal borders where the overlay's edge needs to read distinctly
	// against the body behind it. Also pure neutral gray now.
	ColorBorderBright = shellPalette.Mut
	ColorText         = shellPalette.Fg
	ColorTextDim      = shellPalette.Dim
	ColorTextMuted    = shellPalette.Mut
	ColorTeal         = shellPalette.Teal
	ColorTealDim      = shellPalette.Blue
	ColorTealDark     = shellPalette.SelBg
	ColorAmber        = shellPalette.Amber
	ColorRose         = shellPalette.Red
	ColorViolet       = shellPalette.Violet
	ColorGreen        = shellPalette.Green
)

// Style is a thin wrapper around lipgloss that exposes the most common
// pre-configured variants used by the shell + screens. Screens should grab
// these instead of building fresh lipgloss.NewStyle() calls everywhere — keeps
// the visual language consistent and centralized.
var (
	BG        = lipgloss.NewStyle().Background(ColorBG)
	Text      = lipgloss.NewStyle().Foreground(ColorText)
	TextDim   = lipgloss.NewStyle().Foreground(ColorTextDim)
	TextMuted = lipgloss.NewStyle().Foreground(ColorTextMuted)
	Teal      = lipgloss.NewStyle().Foreground(ColorTeal)
	TealBold  = lipgloss.NewStyle().Foreground(ColorTeal).Bold(true)
	Amber     = lipgloss.NewStyle().Foreground(ColorAmber)
	Rose      = lipgloss.NewStyle().Foreground(ColorRose)
	Violet    = lipgloss.NewStyle().Foreground(ColorViolet)
	Green     = lipgloss.NewStyle().Foreground(ColorGreen)
	Panel     = lipgloss.NewStyle().Background(ColorPanel)
	PanelAlt  = lipgloss.NewStyle().Background(ColorPanelAlt)
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
func SeverityColor(severity string) color.Color {
	switch severity {
	case "high":
		return ColorRose
	case "medium":
		return ColorAmber
	default:
		return ColorTextDim
	}
}
