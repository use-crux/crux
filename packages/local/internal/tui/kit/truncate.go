package kit

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

// Truncate returns s clipped to w terminal cells, appending tail when clipped.
//
// Callers should pass a compact tail such as "…". ANSI-heavy
// strings are best clipped at the component boundary; this helper is intended
// for content text and layout tests.
func Truncate(s string, w int, tail string) string {
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) <= w {
		return s
	}
	tailW := lipgloss.Width(tail)
	if tailW >= w {
		return fitPlain(tail, w)
	}
	limit := w - tailW
	var b strings.Builder
	for _, r := range s {
		next := b.String() + string(r)
		if lipgloss.Width(next) > limit {
			break
		}
		b.WriteRune(r)
	}
	return b.String() + tail
}

// TruncateMiddle clips the center of plain content while preserving both its
// identity-bearing prefix and distinguishing tail.
func TruncateMiddle(s string, w int, tail string) string {
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) <= w {
		return s
	}
	tailW := lipgloss.Width(tail)
	if tailW >= w {
		return fitPlain(tail, w)
	}
	contentW := w - tailW
	leftW := (contentW + 1) / 2
	rightW := contentW - leftW
	left := fitPlain(s, leftW)

	var right strings.Builder
	runes := []rune(s)
	for index := len(runes) - 1; index >= 0; index-- {
		candidate := string(runes[index]) + right.String()
		if lipgloss.Width(candidate) > rightW {
			break
		}
		right.Reset()
		right.WriteString(candidate)
	}
	return left + tail + right.String()
}

// Fit bounds an ANSI-styled line to exactly w cells. Clipped lines end in
// tail, making truncation visible instead of silently dropping content.
func Fit(s string, w int, tail string) string {
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) > w {
		s = ansi.Truncate(s, w, tail)
	}
	if width := lipgloss.Width(s); width < w {
		s += strings.Repeat(" ", w-width)
	}
	return s
}

func fitPlain(s string, w int) string {
	if w <= 0 {
		return ""
	}
	if lipgloss.Width(s) <= w {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		next := b.String() + string(r)
		if lipgloss.Width(next) > w {
			break
		}
		b.WriteRune(r)
	}
	return b.String()
}

// FitMiddle lays out a leading label, optional middle detail, and trailing
// metadata on one line. It clips only the middle while the fixed segments fit.
func FitMiddle(width int, leading, middle, trailing, tail string) string {
	if width <= 0 {
		return ""
	}
	trailingWidth := lipgloss.Width(trailing)
	gap := 0
	if trailing != "" {
		gap = 1
	}
	leadingBudget := width - trailingWidth - gap
	if leadingBudget < 0 {
		return ansi.Truncate(trailing, width, "")
	}
	if lipgloss.Width(leading) > leadingBudget {
		leading = ansi.Truncate(leading, leadingBudget, tail)
	}

	middleBudget := leadingBudget - lipgloss.Width(leading)
	if lipgloss.Width(middle) > middleBudget {
		middle = ansi.Truncate(middle, max(0, middleBudget), tail)
	}
	left := leading + middle
	padding := width - lipgloss.Width(left) - trailingWidth
	if trailing != "" && padding < 1 {
		padding = 1
	}
	return left + strings.Repeat(" ", max(0, padding)) + trailing
}
