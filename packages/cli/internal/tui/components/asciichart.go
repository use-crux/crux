package components

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/use-crux/crux/packages/cli/internal/tui/shell"
)

// ASCIIChart renders a multi-row line chart of `values` against `min`/`max`.
// Mirrors the Overview pass-rate chart from the design bundle.
//
// `rows` is the chart height in lines (excluding the axis legend row).
// `width` is the bar count along the x-axis.
// `unitFmt` formats the y-axis label per row, e.g. "%d%%" or "%.1fs".
// `baseline` is a horizontal reference line; pass NaN-equivalent (math.NaN()) to skip.
func ASCIIChart(values []float64, min, max float64, width, rows int, unitFmt string, baseline float64, hasBaseline bool) string {
	if width <= 0 || rows <= 0 || len(values) == 0 {
		return ""
	}
	if width > len(values) {
		width = len(values)
	}
	series := values[len(values)-width:]
	rng := max - min
	if rng <= 0 {
		rng = 1
	}

	point := lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("●")
	pointWarn := lipgloss.NewStyle().Foreground(shell.ColorAmber).Render("●")
	pointFail := lipgloss.NewStyle().Foreground(shell.ColorRose).Render("●")
	tween := lipgloss.NewStyle().Foreground(shell.ColorTextDim).Render("─")
	blank := " "
	axisLabel := lipgloss.NewStyle().Foreground(shell.ColorTextMuted)
	baselineLine := lipgloss.NewStyle().Foreground(shell.ColorTextMuted)

	var out strings.Builder
	for r := 0; r < rows; r++ {
		y := max - (float64(r) * (max - min) / float64(rows-1))
		cellTop := max - (float64(r) * (max - min) / float64(rows-1))
		cellBot := max - (float64(r+1) * (max - min) / float64(rows-1))

		label := axisLabel.Render(formatAxisValue(unitFmt, y))
		out.WriteString(fmt.Sprintf("%6s ", label))

		// On baseline row, render a thin dotted bg line under the data.
		isBaselineRow := hasBaseline && baseline >= cellBot && baseline <= cellTop

		for i := 0; i < width; i++ {
			v := series[i]
			next := v
			if i+1 < width {
				next = series[i+1]
			}
			midY := (v + next) / 2
			ch := blank
			if v >= cellBot && v <= cellTop {
				p := point
				if v < min+(rng*0.30) {
					p = pointFail
				} else if v < min+(rng*0.55) {
					p = pointWarn
				}
				ch = p
			} else if midY >= cellBot && midY <= cellTop {
				ch = tween
			} else if isBaselineRow {
				ch = baselineLine.Render("·")
			}
			out.WriteString(ch)
			out.WriteString(" ")
		}
		out.WriteString("\n")
	}
	return strings.TrimRight(out.String(), "\n")
}

// formatAxisValue accepts either an int-style or float-style format string
// and coerces `v` accordingly. Lets callers pass "%d%%" for integer percent
// labels without panicking when v is a float64.
func formatAxisValue(unitFmt string, v float64) string {
	if strings.Contains(unitFmt, "%d") {
		return fmt.Sprintf(unitFmt, int(v+0.5))
	}
	if strings.Contains(unitFmt, "%f") || strings.Contains(unitFmt, "%g") {
		return fmt.Sprintf(unitFmt, v)
	}
	// Default: round to int.
	return fmt.Sprintf("%d", int(v+0.5))
}
