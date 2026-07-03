package screens

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

func severityTone(severity string) theme.Tone {
	return theme.SeverityTone(severity)
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func wrapLines(text string, width int, style lipgloss.Style) []string {
	if text == "" {
		return []string{strings.Repeat(" ", max(0, width))}
	}
	lines := wrapPlain(text, max(1, width-2))
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		out = append(out, padRow(" "+style.Render(line), width))
	}
	return out
}

func wrapPlain(text string, width int) []string {
	if width <= 0 {
		return nil
	}
	words := strings.Fields(text)
	if len(words) == 0 {
		return []string{""}
	}
	lines := []string{}
	current := ""
	for _, word := range words {
		next := word
		if current != "" {
			next = current + " " + word
		}
		if lipgloss.Width(next) > width && current != "" {
			lines = append(lines, current)
			current = word
			continue
		}
		current = next
	}
	if current != "" {
		lines = append(lines, current)
	}
	return lines
}

func clampLines(lines []string, width, height int) []string {
	if height <= 0 {
		return nil
	}
	out := make([]string, 0, height)
	for i := 0; i < len(lines) && len(out) < height; i++ {
		out = append(out, padRow(lines[i], width))
	}
	for len(out) < height {
		out = append(out, strings.Repeat(" ", max(0, width)))
	}
	return out
}

func latencyLabel(ms float64) string {
	if ms >= 1000 {
		return fmt.Sprintf("%.1fs", ms/1000)
	}
	return fmt.Sprintf("%.0fms", ms)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
