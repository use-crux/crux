// Package output provides formatting and rendering utilities for CLI output.
package output

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

// ── Brand Colors ──────────────────────────────────────────────────

var (
	outputPalette = theme.Resolve(colorprofile.TrueColor)
	outputStyles  = theme.NewStyles(outputPalette)

	AccentColor    = outputPalette.Teal
	AccentDimColor = outputPalette.Blue
	GreenColor     = outputPalette.Green
	RedColor       = outputPalette.Red
	YellowColor    = outputPalette.Amber
	WhiteColor     = outputPalette.Fg
	FgColor        = outputPalette.Fg
	DimColor       = outputPalette.Dim
	BorderColor    = outputPalette.Border
)

// ── Styles ────────────────────────────────────────────────────────

var (
	Accent    = outputStyles.Accent
	AccentDim = outputStyles.Blue
	Green     = outputStyles.Green
	Red       = outputStyles.Red
	Yellow    = outputStyles.Amber
	Cyan      = Accent // Alias for backwards compat.
	Blue      = outputStyles.Blue
	Magenta   = outputStyles.Violet
	Dim       = outputStyles.Dim
	Fg        = outputStyles.Regular
	Bold      = lipgloss.NewStyle().Bold(true)
	BoldCyan  = outputStyles.AccentHeader
	Divider   = outputStyles.Border
)

// ── Logo ──────────────────────────────────────────────────────────

const LogoMark = "◇"

// Logo renders "◇ crux" in accent color.
func Logo(suffix string) string {
	mark := Accent.Bold(true).Render(LogoMark + " crux")
	if suffix != "" {
		mark += " " + Dim.Render(suffix)
	}
	return mark
}

// Header renders a branded section header: "◇ crux <command>\n──────"
func Header(command string) string {
	mark := Accent.Bold(true).Render(LogoMark+" crux") + " " + Bold.Render(command)
	line := Divider.Render(strings.Repeat("─", 50))
	return mark + "\n" + line
}

// ── Status ────────────────────────────────────────────────────────

// Status renders an always-colored status icon for a status key. Prefer the
// color-gated [IO.Status] in command output so `--no-color`/non-TTY render the
// bare glyph; this unconditional form suits callers that have already decided to
// colorize.
func Status(s string) string {
	return statusStyle(s).Render(statusGlyph(s))
}

// statusGlyph returns the plain (uncolored) icon for a status key. It is the
// codepoint half of [Status]; [IO.Status] pairs it with [statusStyle] through
// [IO.Sprint] so the same glyph appears in both plain and colored output.
func statusGlyph(s string) string {
	switch s {
	case "success", "completed":
		return "✓"
	case "error", "failed":
		return "✗"
	case "running":
		return "●"
	case "suspended":
		return "⏸"
	case "cancelled":
		return "⊘"
	case "expired":
		return "⏱"
	default:
		return "?"
	}
}

// statusStyle returns the lipgloss style paired with a status key's glyph. It is
// the color half of [Status]; kept in lockstep with [statusGlyph].
func statusStyle(s string) lipgloss.Style {
	switch s {
	case "success", "completed":
		return Green
	case "error", "failed", "expired":
		return Red
	case "running", "suspended":
		return Yellow
	default: // cancelled and any unknown key render dim
		return Dim
	}
}

// ── Model Names ───────────────────────────────────────────────────

// Known provider prefixes to strip.
var providerPrefixes = []string{
	"openai/", "google/", "anthropic/", "x-ai/", "openrouter/",
	"meta/", "mistral/", "cohere/", "deepseek/",
}

// Exact match shorthands for common dated model IDs.
var modelShorthands = map[string]string{
	"claude-sonnet-4-20250514":  "sonnet-4",
	"claude-opus-4-20250514":    "opus-4",
	"claude-haiku-3-5-20241022": "haiku-3.5",
	"gpt-4.1-mini-2025-04-14":   "gpt-4.1-mini",
	"gpt-4.1-2025-04-14":        "gpt-4.1",
	"gpt-4.1-nano-2025-04-14":   "gpt-4.1-nano",
}

// ShortenModel abbreviates a model ID for display.
func ShortenModel(model string) string {
	// 1. Exact match.
	if short, ok := modelShorthands[model]; ok {
		return short
	}

	// 2. Strip provider prefix.
	for _, prefix := range providerPrefixes {
		if strings.HasPrefix(model, prefix) {
			model = model[len(prefix):]
			break
		}
	}

	// 3. Check again after stripping prefix.
	if short, ok := modelShorthands[model]; ok {
		return short
	}

	// 4. Truncate if still too long.
	if len(model) > 20 {
		return model[:19] + "…"
	}
	return model
}
