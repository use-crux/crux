package shell

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Keybind is one inline `key  label` hint shown in the status bar.
type Keybind struct {
	Key   string
	Label string
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

// StatusBar renders the bottom keybind + path bar. Per ADR-0050, the TUI
// is modeless: no mode chip, no NORMAL/INSERT/COMMAND label. The status
// bar is pure keybind context — what the user can press right now.
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
	pad := width - leftW - rightW
	if pad < 1 {
		pad = 1
	}

	bar := left + strings.Repeat(" ", pad) + right
	return lipgloss.NewStyle().
		Background(ColorPanel).
		Foreground(ColorTextMuted).
		Width(width).
		Render(bar)
}
