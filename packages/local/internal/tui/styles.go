package tui

import (
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

// Centralized style definitions for the TUI.
// Colors mirror output/color.go but are unexported for internal use.

var (
	tuiPalette = theme.Resolve(colorprofile.TrueColor)

	accent    = tuiPalette.Teal
	accentDim = tuiPalette.Blue
	white     = tuiPalette.Fg
	fg        = tuiPalette.Fg
	dim       = tuiPalette.Dim
	border    = tuiPalette.Border
	green     = tuiPalette.Green
	red       = tuiPalette.Red
	yellow    = tuiPalette.Amber
	selectBg  = tuiPalette.SelBg

	logoStyle      = lipgloss.NewStyle().Bold(true).Foreground(accent)
	headerBar      = lipgloss.NewStyle().Foreground(fg).PaddingLeft(1).PaddingBottom(0)
	paneStyle      = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(border)
	paneTitleStyle = lipgloss.NewStyle().Bold(true).Foreground(accent).PaddingLeft(1)
	selStyle       = lipgloss.NewStyle().Background(selectBg).Foreground(white)
	footStyle      = lipgloss.NewStyle().Foreground(dim).PaddingLeft(1)
	keyStyle       = lipgloss.NewStyle().Foreground(accent).Bold(true)
	labelStyle     = lipgloss.NewStyle().Foreground(dim)
	valStyle       = lipgloss.NewStyle().Foreground(fg).Bold(true)
	greenStyle     = lipgloss.NewStyle().Foreground(green)
	redStyle       = lipgloss.NewStyle().Foreground(red)
	yellowStyle    = lipgloss.NewStyle().Foreground(yellow)
	dimStyle       = lipgloss.NewStyle().Foreground(dim)
	fgStyle        = lipgloss.NewStyle().Foreground(fg)
	accentStyle    = lipgloss.NewStyle().Foreground(accent)
)
