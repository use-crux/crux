package screens

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type favorableDirection int

const (
	favorableDown favorableDirection = -1
	favorableUp   favorableDirection = 1
)

func (o *Overview) renderKPIStrip(width int) string {
	summary := o.overviewSummary()
	contentW := width - 3
	if contentW < 4 {
		contentW = 4
	}
	cellW := contentW / 4
	rem := contentW - cellW*4

	openChange := float64(0)
	if len(summary.OpenInsightsHistory) >= 2 {
		openChange = float64(summary.OpenInsightsHistory[len(summary.OpenInsightsHistory)-1] - summary.OpenInsightsHistory[0])
	}
	passDelta := passRateDeltaSeries(summary)
	passChange, _ := seriesDelta(passDelta)
	costChange, _ := seriesDelta(summary.CostSpark)
	latencyChange, _ := seriesDelta(summary.LatencySpark)

	o1 := o.kpiCell(cellW, "Open insights",
		fmt.Sprintf("%d", summary.InsightCount),
		fmtDeltaCount(summary.OpenInsightsHistory),
		deltaColor(openChange, favorableDown),
		overviewSparkFromInts(summary.OpenInsightsHistory, summary.InsightCount),
		shell.ColorTeal,
	)
	o2 := o.kpiCell(cellW, "Pass rate",
		percent(summary.PassRate),
		fmtDeltaRate(passDelta),
		deltaColor(passChange, favorableUp),
		passRateSpark(summary),
		shell.ColorRose,
	)
	o3 := o.kpiCell(cellW, "Cost / 100 runs",
		dollars(summary.CostPer100Runs),
		fmtDeltaCost(summary.CostSpark),
		deltaColor(costChange, favorableDown),
		metricSpark(summary.CostSpark, summary.CostPer100Runs),
		shell.ColorAmber,
	)
	o4 := o.kpiCell(cellW+rem, "p95 latency",
		latency(summary.P95LatencyMs),
		fmtDeltaLatency(summary.LatencySpark),
		deltaColor(latencyChange, favorableDown),
		metricSpark(summary.LatencySpark, summary.P95LatencyMs),
		shell.ColorAmber,
	)

	// Compose adds a vertical border between cells, which gives the design's
	// crisp 4-cell strip a clear separator.
	// The body panes' headers carry their own top divider now (see
	// PaneHeader); skipping the explicit one here avoids a double rule
	// between the KPI strip and the first body section.
	return kit.ComposeColumns(o1, o2, o3, o4)
}

func (o *Overview) kpiCell(width int, label, value, delta string, deltaColor color.Color, spark []float64, sparkColor color.Color) string {
	lbl := shell.SectionTag.Render(label)
	val := lipgloss.NewStyle().
		Foreground(shell.ColorText).
		Bold(true).
		Render(value)
	dlt := lipgloss.NewStyle().Foreground(deltaColor).Render(delta)

	// Sparkline as a filled-area braille curve, given the full inner width
	// of the KPI cell (label/value occupy the rows above).
	sk := ""
	sparkCols := width - 4
	if sparkCols < 8 {
		sparkCols = 8
	}
	if len(spark) > 0 {
		sk = kit.SparklineFilled(spark, sparkCols, sparkColor)
	} else {
		sk = lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("·", sparkCols))
	}

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
