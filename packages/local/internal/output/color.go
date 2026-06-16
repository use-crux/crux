// Package output provides formatting and rendering utilities for CLI output.
package output

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// ── Brand Colors ──────────────────────────────────────────────────

var (
	AccentColor    = lipgloss.Color("#00D4AA")
	AccentDimColor = lipgloss.Color("#007766")
	GreenColor     = lipgloss.Color("#4ADE80")
	RedColor       = lipgloss.Color("#F87171")
	YellowColor    = lipgloss.Color("#FBBF24")
	WhiteColor     = lipgloss.Color("#FFFFFF")
	FgColor        = lipgloss.Color("#C8C8C8")
	DimColor       = lipgloss.Color("#666666")
	BorderColor    = lipgloss.Color("#444444")
)

// ── Styles ────────────────────────────────────────────────────────

var (
	Accent    = lipgloss.NewStyle().Foreground(AccentColor)
	AccentDim = lipgloss.NewStyle().Foreground(AccentDimColor)
	Green     = lipgloss.NewStyle().Foreground(GreenColor)
	Red       = lipgloss.NewStyle().Foreground(RedColor)
	Yellow    = lipgloss.NewStyle().Foreground(YellowColor)
	Cyan      = Accent // Alias for backwards compat.
	Blue      = lipgloss.NewStyle().Foreground(lipgloss.Color("#6699FF"))
	Magenta   = lipgloss.NewStyle().Foreground(lipgloss.Color("#C084FC"))
	Dim       = lipgloss.NewStyle().Foreground(DimColor)
	Fg        = lipgloss.NewStyle().Foreground(FgColor)
	Bold      = lipgloss.NewStyle().Bold(true)
	BoldCyan  = lipgloss.NewStyle().Bold(true).Foreground(AccentColor)
	Divider   = lipgloss.NewStyle().Foreground(BorderColor)
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
