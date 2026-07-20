package screens

import (
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

// sanitizeRunsInline projects runtime-owned text into one safe terminal row.
// Callers must use it before measuring, truncating, or applying terminal style.
func sanitizeRunsInline(value string) string {
	return kit.SanitizeInline(value)
}

// truncateRunsInline sanitizes before clipping by terminal cells. This avoids
// measuring escape payloads and splitting multi-byte authored text.
func truncateRunsInline(value string, width int) string {
	return clipSanitizedRunsInline(sanitizeRunsInline(value), width, "…")
}

func clipRunsInline(value string, width int) string {
	return clipSanitizedRunsInline(sanitizeRunsInline(value), width, "")
}

func padRunsInline(value string, width int) string {
	value = truncateRunsInline(value, width)
	if padding := width - lipgloss.Width(value); padding > 0 {
		value += strings.Repeat(" ", padding)
	}
	return value
}

func clipSanitizedRunsInline(value string, width int, tail string) string {
	if lipgloss.Width(value) <= width {
		return value
	}
	return kit.Truncate(value, width, tail)
}

// sanitizeRunsRenderValue recursively sanitizes the render-only JSON
// projection used by primitive detail panes. The source payload stays exact
// for inspect and export.
func sanitizeRunsRenderValue(value any) any {
	switch typed := value.(type) {
	case string:
		return sanitizeRunsInline(typed)
	case []any:
		safe := make([]any, len(typed))
		for index, item := range typed {
			safe[index] = sanitizeRunsRenderValue(item)
		}
		return safe
	case map[string]any:
		safe := make(map[string]any, len(typed))
		for key, item := range typed {
			safe[sanitizeRunsInline(key)] = sanitizeRunsRenderValue(item)
		}
		return safe
	default:
		return value
	}
}
