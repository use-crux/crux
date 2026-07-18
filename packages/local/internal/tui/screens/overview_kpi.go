package screens

import (
	"fmt"
	"image/color"
	"strings"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (o *Overview) renderKPIStrip(width int) string {
	contentW := width - 3
	if contentW < 4 {
		contentW = 4
	}
	cellW := contentW / 4
	rem := contentW - cellW*4

	// KPI accent colors match the design's visual coding:
	//   Open insights → teal (neutral trend; severity counts carry the
	//     status info as colored sub-text)
	//   Pass rate     → rose (going-down-is-bad)
	//   Cost / latency → amber (going-up-is-bad)
	o1 := o.kpiCell(cellW, "Open insights",
		fmt.Sprintf("%d", o.overview.InsightCount),
		o.formatSeverityCounts(),
		shell.ColorTextDim,
		overviewSparkFromInts(o.overview.OpenInsightsHistory, o.overview.InsightCount),
		shell.ColorTeal,
	)
	o2 := o.kpiCell(cellW, "Pass rate",
		percent(o.overview.PassRate),
		"",
		shell.ColorRose,
		passRateSpark(o.overview),
		shell.ColorRose,
	)
	o3 := o.kpiCell(cellW, "Cost / 100 runs",
		dollars(o.overview.CostPer100Runs),
		fmtDeltaCost(o.overview.CostSpark),
		shell.ColorAmber,
		metricSpark(o.overview.CostSpark, o.overview.CostPer100Runs),
		shell.ColorAmber,
	)
	o4 := o.kpiCell(cellW+rem, "p95 latency",
		latency(o.overview.P95LatencyMs),
		fmtDeltaLatency(o.overview.LatencySpark),
		shell.ColorAmber,
		metricSpark(o.overview.LatencySpark, o.overview.P95LatencyMs),
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

func (o *Overview) formatSeverityCounts() string {
	c := o.overview.OpenInsightSeverityCounts
	if len(c) == 0 {
		return ""
	}
	parts := make([]string, 0, 3)
	if h := c["high"]; h > 0 {
		parts = append(parts, fmt.Sprintf("%d high", h))
	}
	// Accept both `medium` (canonical) and `med` (shorthand sometimes
	// used by backend) so the chip never disappears due to naming drift.
	if m := c["medium"] + c["med"]; m > 0 {
		parts = append(parts, fmt.Sprintf("%d med", m))
	}
	if l := c["low"]; l > 0 {
		parts = append(parts, fmt.Sprintf("%d low", l))
	}
	return strings.Join(parts, " · ")
}
