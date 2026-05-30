// Package components contains small render-only widgets reused across the
// Quality screens — chips/pills, sparklines, status dots, ASCII charts. None
// of these own state; they take inputs and return a string.
package components

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Chip renders a filled-background pill with an UPPERCASE label —
// matches the design for category labels (`HIGH`, `RETRIEVAL`, `INS-014`).
// `bg` is the rectangle color; foreground is the panel background tone
// so the label pops out of the chip.
func Chip(label string, bg lipgloss.Color) string {
	return lipgloss.NewStyle().
		Background(bg).
		Foreground(shell.ColorBG).
		Bold(true).
		Padding(0, 1).
		Render(strings.ToUpper(label))
}

// ChipState renders a filled-background pill that PRESERVES case —
// matches the design for state markers (`changed`, `curated`, `pinned`,
// `draft`, `live`, `snapshot`, `frozen`) and other lowercase status
// labels. Identical to Chip but without the uppercase pass.
func ChipState(label string, bg lipgloss.Color) string {
	return lipgloss.NewStyle().
		Background(bg).
		Foreground(shell.ColorBG).
		Bold(true).
		Padding(0, 1).
		Render(label)
}

// ChipTag renders the muted tag-style chip used for definition kinds
// and unobtrusive metadata — dim foreground on a slightly darker fill.
// Preserves label case (tags in the design are mixed-case).
func ChipTag(label string) string {
	return lipgloss.NewStyle().
		Background(shell.ColorSurface).
		Foreground(shell.ColorTextDim).
		Padding(0, 1).
		Render(label)
}

// ChipDim is the legacy alias for ChipTag — kept so existing call sites
// don't churn. Prefer ChipTag in new code.
func ChipDim(label string) string { return ChipTag(label) }

// underscore keeps `strings` in use even if the only caller (Chip's
// ToUpper) is the sole reference — silences staticcheck warnings if
// the chip helpers grow non-strings paths.
var _ = strings.ToUpper
