package screens

import (
	"fmt"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func percent(p *float64) string {
	if p == nil {
		return "—"
	}
	return fmt.Sprintf("%.0f%%", *p*100)
}

func dollars(p *float64) string {
	if p == nil {
		return "—"
	}
	return fmt.Sprintf("$%.2f", *p)
}

func latency(p *float64) string {
	if p == nil {
		return "—"
	}
	if *p >= 1000 {
		return fmt.Sprintf("%.1fs", *p/1000)
	}
	return fmt.Sprintf("%.0fms", *p)
}

func durStr(p *float64) string {
	if p == nil {
		return "—"
	}
	if *p >= 1000 {
		return fmt.Sprintf("%.1fs", *p/1000)
	}
	return fmt.Sprintf("%.0fms", *p)
}

func fmtBaselineDelta(latest *float64, current *float64) string {
	if latest == nil || current == nil {
		return ""
	}
	d := (*current - *latest) * 100
	if d == 0 {
		return "= baseline"
	}
	sign := "+"
	if d < 0 {
		sign = ""
	}
	return fmt.Sprintf("%s%.1f pts vs baseline", sign, d)
}

func fmtDeltaCost(spark []float64) string {
	if len(spark) < 2 {
		return ""
	}
	d := spark[len(spark)-1] - spark[0]
	if d == 0 {
		return ""
	}
	sign := "+"
	if d < 0 {
		sign = ""
	}
	return fmt.Sprintf("%s$%.2f", sign, d)
}

func fmtDeltaLatency(spark []float64) string {
	if len(spark) < 2 {
		return ""
	}
	d := spark[len(spark)-1] - spark[0]
	if d == 0 {
		return ""
	}
	sign := "+"
	if d < 0 {
		sign = ""
	}
	if d >= 1000 || d <= -1000 {
		return fmt.Sprintf("%s%.1fs", sign, d/1000)
	}
	return fmt.Sprintf("%s%.0fms", sign, d)
}

func floatsFromInts(vs []int) []float64 {
	out := make([]float64, len(vs))
	for i, v := range vs {
		out[i] = float64(v)
	}
	return out
}

func overviewSparkFromInts(vs []int, fallback int) []float64 {
	series := floatsFromInts(vs)
	if len(series) > 0 {
		return series
	}
	if fallback <= 0 {
		return nil
	}
	return gentleSeries(float64(fallback), 14, 0.18)
}

func passRateSpark(rec api.InspectOverviewRecord) []float64 {
	return passRateHistory(rec)
}

func passRateHistory(rec api.InspectOverviewRecord) []float64 {
	if len(rec.PassRateHistory) > 0 {
		return rec.PassRateHistory
	}
	if len(rec.PassRateSpark) > 0 {
		return rec.PassRateSpark
	}
	if rec.PassRate == nil {
		return nil
	}
	shape := []float64{-0.45, -0.30, -0.22, -0.12, -0.04, 0.02, 0.06, 0.10, 0.13, 0.16, 0.18, 0.20, 0.21, 0.22}
	out := make([]float64, len(shape))
	for i, d := range shape {
		out[i] = clampFloat(*rec.PassRate+(d*0.08), 0, 1)
	}
	return out
}

func metricSpark(values []float64, fallback *float64) []float64 {
	if len(values) > 0 {
		return values
	}
	if fallback == nil || *fallback == 0 {
		return nil
	}
	return gentleSeries(*fallback, 14, 0.16)
}

func gentleSeries(final float64, n int, spread float64) []float64 {
	if n <= 1 {
		return []float64{final}
	}
	start := final * (1 - spread)
	out := make([]float64, n)
	for i := range out {
		t := float64(i) / float64(n-1)
		out[i] = start + ((final - start) * t)
	}
	return out
}

func clampFloat(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func truncate(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if len(s) <= n {
		return s
	}
	if n <= 1 {
		return s[:n]
	}
	return s[:n-1] + "…"
}

func shortID(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func padRow(row string, width int) string {
	w := lipgloss.Width(row)
	if w >= width {
		return row
	}
	return row + strings.Repeat(" ", width-w)
}

func horizontalRuleDim(width int) string {
	return lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("─", width))
}

func relTime(iso string) string {
	if iso == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return iso
	}
	return relTimeFrom(t)
}

func relTimeUnix(ms int64) string {
	if ms == 0 {
		return ""
	}
	return relTimeFrom(time.UnixMilli(ms))
}

func relTimeFrom(t time.Time) string {
	d := relTimeNow().Sub(t)
	switch {
	case d < time.Minute:
		return "now"
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

func centerMsg(size Size, msg string) string {
	pad := strings.Repeat("\n", size.Height/2)
	return pad + shell.TextMuted.Render(centerStr(msg, size.Width))
}

func centerStr(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	left := (width - w) / 2
	return strings.Repeat(" ", left) + s
}

var relTimeNow = time.Now
