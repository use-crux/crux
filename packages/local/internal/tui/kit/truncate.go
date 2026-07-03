package kit

import (
	"strings"

	"charm.land/lipgloss/v2"
)

// Truncate returns s clipped to w terminal cells, appending tail when clipped.
//
// Callers should pass a one-cell tail such as "..." or "…". ANSI-heavy
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
