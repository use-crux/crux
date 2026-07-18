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
func StatusBar(width int, keybinds []Keybind, path string) string {
	if len(keybinds) == 0 {
		keybinds = layer1Fallback
	}

	hints := make([]string, 0, len(keybinds))
	keyStyle := lipgloss.NewStyle().Foreground(ColorTeal)
	labelStyle := lipgloss.NewStyle().Foreground(ColorTextMuted)
	for _, k := range keybinds {
		hints = append(hints, keyStyle.Render(k.Key)+" "+labelStyle.Render(k.Label))
	}
	left := " " + strings.Join(hints, "  ")

	right := lipgloss.NewStyle().Foreground(ColorTextMuted).Render(path)

	leftW := lipgloss.Width(left)
	rightW := lipgloss.Width(right)
	if leftW+rightW > width {
		maxLeft := width - rightW - 1
		if maxLeft < 0 {
			maxLeft = 0
		}
		left = lipgloss.NewStyle().MaxWidth(maxLeft).Render(left)
		leftW = lipgloss.Width(left)
	}
	pad := width - leftW - rightW
	if pad < 0 {
		pad = 0
	}

	bar := left + strings.Repeat(" ", pad) + right
	return lipgloss.NewStyle().
		Background(ColorPanel).
		Foreground(ColorTextMuted).
		Width(width).
		Render(bar)
}
