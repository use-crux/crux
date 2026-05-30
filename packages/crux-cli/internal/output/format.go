// Package output provides formatting and rendering utilities for CLI output.
package output

import (
	"fmt"
	"time"
)

// FormatTokens formats a token count: "1.5M", "234.5k", "567".
func FormatTokens(n int) string {
	if n >= 1_000_000 {
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	}
	if n >= 1_000 {
		return fmt.Sprintf("%.1fk", float64(n)/1_000)
	}
	return fmt.Sprintf("%d", n)
}

// FormatCost formats a USD cost: "$0.12" or "$0.0042".
func FormatCost(n float64) string {
	if n >= 0.01 {
		return fmt.Sprintf("$%.2f", n)
	}
	return fmt.Sprintf("$%.4f", n)
}

// FormatDuration formats milliseconds: "45.2s" or "1.2m".
func FormatDuration(ms float64) string {
	s := ms / 1000
	if s >= 60 {
		return fmt.Sprintf("%.1fm", s/60)
	}
	return fmt.Sprintf("%.1fs", s)
}

// FormatPercent formats a ratio as a percentage: "93%".
func FormatPercent(n float64) string {
	return fmt.Sprintf("%.0f%%", n*100)
}

// FormatTime formats a unix timestamp (ms) as "HH:MM:SS" in local time.
func FormatTime(ms int64) string {
	t := time.UnixMilli(ms)
	return t.Format("15:04:05")
}

// BarSegment represents one segment of a multi-part token bar.
type BarSegment struct {
	Value int
	Char  rune // e.g. '█', '▓', '░'
}

// TokenBar renders a proportional ASCII bar: "████████░░░░".
func TokenBar(used, total, width int) string {
	if total <= 0 || width <= 0 {
		return ""
	}
	filled := used * width / total
	if filled > width {
		filled = width
	}
	result := make([]rune, width)
	for i := range result {
		if i < filled {
			result[i] = '█'
		} else {
			result[i] = '░'
		}
	}
	return string(result)
}

// TokenBarSegmented renders a multi-segment bar.
// Segments are drawn left to right. Remaining width is filled with '░'.
func TokenBarSegmented(segments []BarSegment, total, width int) string {
	if total <= 0 || width <= 0 {
		return ""
	}
	result := make([]rune, width)
	for i := range result {
		result[i] = '░'
	}
	pos := 0
	for _, seg := range segments {
		segWidth := seg.Value * width / total
		if segWidth == 0 && seg.Value > 0 {
			segWidth = 1 // At least 1 char for non-zero segments.
		}
		for i := 0; i < segWidth && pos < width; i++ {
			result[pos] = seg.Char
			pos++
		}
	}
	return string(result)
}

// MiniBar renders a small proportional bar for inline use (e.g. system parts).
func MiniBar(value, max, width int) string {
	if max <= 0 || width <= 0 {
		return ""
	}
	filled := value * width / max
	if filled > width {
		filled = width
	}
	if filled == 0 && value > 0 {
		filled = 1
	}
	result := make([]rune, width)
	for i := range result {
		if i < filled {
			result[i] = '█'
		} else {
			result[i] = '░'
		}
	}
	return string(result)
}

// FormatRelativeTime formats a unix timestamp (ms) as "2s ago", "5m ago".
func FormatRelativeTime(ms int64) string {
	delta := time.Since(time.UnixMilli(ms))
	secs := int(delta.Seconds())
	if secs < 60 {
		return fmt.Sprintf("%ds ago", secs)
	}
	mins := secs / 60
	if mins < 60 {
		return fmt.Sprintf("%dm ago", mins)
	}
	hours := mins / 60
	return fmt.Sprintf("%dh ago", hours)
}
