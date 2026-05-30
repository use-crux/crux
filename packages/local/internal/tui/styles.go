package tui

import "github.com/charmbracelet/lipgloss"

// Centralized style definitions for the TUI.
// Colors mirror output/color.go but are unexported for internal use.

var (
	accent    = lipgloss.Color("#00D4AA")
	accentDim = lipgloss.Color("#007766")
	white     = lipgloss.Color("#FFFFFF")
	fg        = lipgloss.Color("#C8C8C8")
	dim       = lipgloss.Color("#666666")
	border    = lipgloss.Color("#444444")
	green     = lipgloss.Color("#4ADE80")
	red       = lipgloss.Color("#F87171")
	yellow    = lipgloss.Color("#FBBF24")
	selectBg  = lipgloss.Color("#1A3A4A")

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
