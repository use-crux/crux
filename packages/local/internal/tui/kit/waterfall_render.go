package kit

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
)

func opColor(op string) color.Color {
	switch op {
	case "agent":
		return adapterPalette.Teal
	case "llm":
		return adapterPalette.Violet
	case "tool":
		return adapterPalette.Amber
	default:
		return adapterPalette.Dim
	}
}

func opStyle(op string) lipgloss.Style {
	return lipgloss.NewStyle().Foreground(opColor(op))
}

func selectionPrefix(selected bool) string {
	if selected {
		return lipgloss.NewStyle().Foreground(adapterPalette.Teal).Render("▌")
	}
	return " "
}

func makeBar(width int, offsetFrac, widthFrac float64, c color.Color, selected bool) string {
	if width <= 0 {
		return ""
	}
	if offsetFrac < 0 || offsetFrac != offsetFrac {
		offsetFrac = 0
	}
	if offsetFrac > 1 {
		offsetFrac = 1
	}
	if widthFrac < 0 || widthFrac != widthFrac {
		widthFrac = 0
	}
	if widthFrac > 1 {
		widthFrac = 1
	}
	offset := int(offsetFrac * float64(width))
	if offset < 0 {
		offset = 0
	}
	if offset >= width {
		offset = width - 1
	}
	bw := int(widthFrac * float64(width))
	if bw < 1 {
		bw = 1
	}
	if offset+bw > width {
		bw = width - offset
		if bw < 1 {
			bw = 1
		}
	}
	pre := strings.Repeat(" ", offset)
	style := lipgloss.NewStyle().Foreground(c)
	_ = selected
	bar := style.Render(strings.Repeat("█", bw))
	post := ""
	if rem := width - offset - bw; rem > 0 {
		post = strings.Repeat(" ", rem)
	}
	return pre + bar + post
}

func padString(s string, width int) string {
	if len(s) >= width {
		if width <= 1 {
			return s[:width]
		}
		return s[:width-1] + "…"
	}
	return s + strings.Repeat(" ", width-len(s))
}

func padRowToWidth(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func formatDuration(ms float64) string {
	if ms >= 1000 {
		return fmt.Sprintf("%.2fs", ms/1000)
	}
	return fmt.Sprintf("%dms", int(ms))
}

// WaterfallRuler renders the time ruler shown above the waterfall.
func WaterfallRuler(totalMs float64, width int) string {
	if totalMs <= 0 || width <= 0 {
		return strings.Repeat(" ", width)
	}
	const labelCols = 2 + 1 + 6 + 1 + 28 + 1
	barCol := width - labelCols - 7 - 1
	if barCol < 8 {
		barCol = 8
	}
	totalSec := totalMs / 1000.0
	step := 1.0
	switch {
	case totalSec > 30:
		step = 5
	case totalSec > 15:
		step = 2
	case totalSec > 8:
		step = 1
	case totalSec > 3:
		step = 0.5
	default:
		step = 0.2
	}

	tickStyle := lipgloss.NewStyle().Foreground(adapterPalette.Mut)
	endStyle := lipgloss.NewStyle().Foreground(adapterPalette.Dim)
	labelRow := make([]rune, barCol)
	for i := range labelRow {
		labelRow[i] = ' '
	}
	for t := 0.0; t <= totalSec; t += step {
		pos := int((t / totalSec) * float64(barCol))
		if pos < 0 || pos >= barCol {
			continue
		}
		label := fmt.Sprintf("%gs", t)
		for i, r := range label {
			if pos+i >= barCol {
				break
			}
			labelRow[pos+i] = r
		}
	}

	rendered := strings.Repeat(" ", labelCols) +
		tickStyle.Render(string(labelRow)) +
		"  " + endStyle.Render(fmt.Sprintf("%.1fs", totalSec))
	if w := lipgloss.Width(rendered); w < width {
		rendered += strings.Repeat(" ", width-w)
	}
	return rendered
}
