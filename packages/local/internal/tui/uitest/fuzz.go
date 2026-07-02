package uitest

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
)

// FuzzResize renders a surface across the supported fuzz matrix.
func FuzzResize(t *testing.T, render func(width, height int) string) {
	t.Helper()
	for width := 60; width <= 200; width += 4 {
		for height := 20; height <= 60; height += 4 {
			out := render(width, height)
			lines := strings.Split(out, "\n")
			if len(lines) > height {
				t.Fatalf("%dx%d rendered %d lines", width, height, len(lines))
			}
			for i, line := range lines {
				if got := lipgloss.Width(line); got > width {
					t.Fatalf("%dx%d line %d width = %d, want <= %d: %q", width, height, i+1, got, width, line)
				}
			}
			if width >= 80 && hasTruncatedPaneHeader(lines) {
				t.Fatalf("%dx%d rendered a truncated pane header", width, height)
			}
		}
	}
}

func hasTruncatedPaneHeader(lines []string) bool {
	for i, line := range lines {
		if i > 0 && !looksLikeBoxHeader(line) {
			return false
		}
		plain := strings.TrimSpace(line)
		if plain == "" {
			continue
		}
		if !strings.Contains(plain, "…") {
			return false
		}
		return looksLikeHeaderLine(plain)
	}
	return false
}

func looksLikeHeaderLine(line string) bool {
	if looksLikeBoxHeader(line) {
		return true
	}
	if strings.Contains(line, "│") || strings.Contains(line, "╭") || strings.Contains(line, "╮") {
		return true
	}
	return len([]rune(line)) <= 40
}

func looksLikeBoxHeader(line string) bool {
	trimmed := strings.TrimSpace(line)
	return strings.HasPrefix(trimmed, "╭") || strings.HasPrefix(trimmed, "┌")
}
