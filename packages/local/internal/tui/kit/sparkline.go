package kit

import (
	"image/color"
	"math"
	"strings"

	"charm.land/lipgloss/v2"
)

var sparkChars = []rune{'▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'}

// Sparkline renders one honest block-ramp cell per value. Short and flat
// series carry no trend signal, so they render nothing.
func Sparkline(values []float64, width int, c color.Color) string {
	if len(values) < 4 {
		return ""
	}
	if width > 0 && len(values) > width {
		values = values[len(values)-width:]
	}
	minValue, maxValue := values[0], values[0]
	for _, value := range values[1:] {
		if value < minValue {
			minValue = value
		}
		if value > maxValue {
			maxValue = value
		}
	}
	if maxValue == minValue {
		return ""
	}

	var out strings.Builder
	for _, value := range values {
		position := (value - minValue) / (maxValue - minValue)
		index := int(math.Round(position * float64(len(sparkChars)-1)))
		index = min(max(index, 0), len(sparkChars)-1)
		out.WriteRune(sparkChars[index])
	}
	return lipgloss.NewStyle().Foreground(c).Render(out.String())
}
