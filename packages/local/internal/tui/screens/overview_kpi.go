package screens

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type favorableDirection int

const (
	favorableDown favorableDirection = -1
	favorableUp   favorableDirection = 1
)

type overviewKPICell struct {
	label      string
	value      string
	delta      string
	deltaColor color.Color
	spark      []float64
	sparkColor color.Color
}

func (o *Overview) renderKPIStrip(width int) string {
	summary := o.overviewSummary()
	stats := o.projectedStats()

	openChange := float64(0)
	if len(summary.OpenInsightsHistory) >= 2 {
		openChange = float64(summary.OpenInsightsHistory[len(summary.OpenInsightsHistory)-1] - summary.OpenInsightsHistory[0])
	}
	passChange, _ := seriesDelta(stats.PassRateSeries)
	costChange, _ := seriesDelta(stats.CostSeries)
	latencyChange, _ := seriesDelta(stats.LatencySeries)

	cells := []overviewKPICell{
		{
			label: "Open insights", value: fmt.Sprintf("%d", summary.InsightCount),
			delta: fmtDeltaCount(summary.OpenInsightsHistory), deltaColor: deltaColor(openChange, favorableDown),
			spark: floatsFromInts(summary.OpenInsightsHistory), sparkColor: shell.ColorTeal,
		},
		{
			label: "Pass rate", value: percent(firstFloat(stats.PassRate, summary.PassRate)),
			delta: fmtDeltaRate(stats.PassRateSeries), deltaColor: deltaColor(passChange, favorableUp),
			spark: stats.PassRateSeries, sparkColor: shell.ColorRose,
		},
	}
	if summary.MeanScore != nil {
		cells = append(cells, overviewKPICell{
			label: "Mean score", value: score(summary.MeanScore),
			deltaColor: shell.ColorAmber, sparkColor: shell.ColorViolet,
		})
	}
	cells = append(cells,
		overviewKPICell{
			label: "Cost / 100 runs", value: dollars(stats.CostPer100Runs),
			delta: fmtDeltaCost(stats.CostSeries), deltaColor: deltaColor(costChange, favorableDown),
			spark: stats.CostSeries, sparkColor: shell.ColorAmber,
		},
		overviewKPICell{
			label: "p95 latency", value: latency(summary.P95LatencyMs),
			delta: fmtDeltaLatency(stats.LatencySeries), deltaColor: deltaColor(latencyChange, favorableDown),
			spark: stats.LatencySeries, sparkColor: shell.ColorAmber,
		},
	)

	contentW := width - len(cells) + 1
	if contentW < 4 {
		contentW = 4
	}
	cellW := contentW / len(cells)
	rem := contentW - cellW*len(cells)
	rendered := make([]string, 0, len(cells))
	for i, cell := range cells {
		width := cellW
		if i == len(cells)-1 {
			width += rem
		}
		rendered = append(rendered, o.kpiCell(
			width,
			cell.label,
			cell.value,
			cell.delta,
			cell.deltaColor,
			cell.spark,
			cell.sparkColor,
		))
	}

	// Compose adds a vertical border between cells, which gives the KPI strip
	// clear separators even when the optional mean-score cell is present.
	// The body panes' headers carry their own top divider now (see
	// PaneHeader); skipping the explicit one here avoids a double rule
	// between the KPI strip and the first body section.
	band := strings.Split(kit.ComposeColumnsOpen(rendered...), "\n")
	for index := range band {
		band[index] = theme.SurfaceLine(shell.SurfaceBand, band[index], width)
	}
	return strings.Join(band, "\n")
}

func (o *Overview) kpiCell(width int, label, value, delta string, deltaColor color.Color, spark []float64, sparkColor color.Color) string {
	lbl := shell.SectionTag.Render(label)
	val := lipgloss.NewStyle().
		Foreground(shell.ColorText).
		Bold(true).
		Render(value)
	dlt := lipgloss.NewStyle().Foreground(deltaColor).Render(delta)

	// The shared renderer hides short or flat series instead of inventing a
	// trend, and uses one data point per block-ramp cell.
	sk := ""
	sparkCols := width - 4
	if sparkCols < 8 {
		sparkCols = 8
	}
	sk = kit.Sparkline(spark, sparkCols, sparkColor)

	// 5 rows: blank · label · big value + inline delta · blank · sparkline
	cell := strings.Join([]string{
		"",
		" " + lbl,
		" " + val + "  " + dlt,
		"",
		" " + sk,
	}, "\n")
	return panelRect(cell, width, 5)
}

func deltaColor(change float64, favorable favorableDirection) color.Color {
	if change == 0 {
		return shell.ColorAmber
	}
	if (change > 0 && favorable == favorableUp) || (change < 0 && favorable == favorableDown) {
		return shell.ColorGreen
	}
	return shell.ColorRose
}
