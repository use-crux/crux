package shell

import (
	"strings"

	"charm.land/lipgloss/v2"
)

// Keybind is one inline `key  label` hint shown in the status bar.
type Keybind struct {
	Key   string
	Label string
}

// Bind creates a status-bar key hint.
func Bind(key, label string) Keybind {
	return Keybind{Key: key, Label: label}
}

// StatusBadge is a compact right-aligned status entry. Full and Compact must
// each be complete labels: StatusBar never truncates either one.
type StatusBadge struct {
	Full    string
	Compact string
	Warning bool
}

const maxStatusBadgeWidth = 28

// layer1Fallback is the minimal global keybind hint set, surfaced when the
// active screen returns an empty Keybinds() list. Per KEYBINDS.md, every
// screen owns its own keymap; the workbench shows only the truly-global
// chords as fallback.
var layer1Fallback = []Keybind{
	{":", "cmd"},
	{"?", "help"},
	{"g", "jump"},
	{"/", "search"},
}

// StatusBar renders the bottom keybind + path bar. Per the approved 2026-07-16
// TUI stabilization design, it has no mode chip: the bar shows only executable
// keys available in the current context.
func StatusBar(width int, keybinds []Keybind, badge StatusBadge) string {
	if width <= 0 {
		return ""
	}
	if len(keybinds) == 0 {
		keybinds = layer1Fallback
	}

	hints := make([]string, 0, len(keybinds))
	keyStyle := lipgloss.NewStyle().Foreground(ColorTeal)
	labelStyle := lipgloss.NewStyle().Foreground(ColorTextMuted)
	for _, k := range keybinds {
		hints = append(hints, keyStyle.Render(k.Key)+" "+labelStyle.Render(k.Label))
	}

	badgeStyle := lipgloss.NewStyle().Foreground(ColorTextMuted)
	if badge.Warning {
		badgeStyle = lipgloss.NewStyle().Foreground(ColorAmber).Bold(true)
	}
	right := ""
	if badge.Full != "" {
		right = badgeStyle.Render(badge.Full)
	}
	if lipgloss.Width(right) > maxStatusBadgeWidth {
		right = badgeStyle.Render(badge.Compact)
	}
	if lipgloss.Width(right) > maxStatusBadgeWidth {
		right = ""
	}

	for len(hints) > 0 && statusBarWidth(hints, right) > width {
		hints = hints[:len(hints)-1]
	}
	if statusBarWidth(hints, right) > width && badge.Compact != "" {
		right = badgeStyle.Render(badge.Compact)
	}
	for len(hints) > 0 && statusBarWidth(hints, right) > width {
		hints = hints[:len(hints)-1]
	}
	if lipgloss.Width(right) > width {
		right = ""
	}

	left := ""
	if len(hints) > 0 {
		left = " " + strings.Join(hints, "  ")
	}
	gap := width - lipgloss.Width(left) - lipgloss.Width(right)
	bar := left + strings.Repeat(" ", max(0, gap)) + right
	return lipgloss.NewStyle().
		Background(ColorPanel).
		Foreground(ColorTextMuted).
		Width(width).
		Render(bar)
}

func statusBarWidth(hints []string, right string) int {
	left := 0
	if len(hints) > 0 {
		left = 1 + lipgloss.Width(strings.Join(hints, "  "))
	}
	gap := 0
	if left > 0 && right != "" {
		gap = 1
	}
	return left + gap + lipgloss.Width(right)
}
