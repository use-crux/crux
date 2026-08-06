package screens

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Evals) runStatusLabel(run evalRunItem) string {
	if run.Passed {
		return "passed"
	}
	if run.Status == "complete" || run.Status == "failed" {
		return "failed"
	}
	if run.Status != "" {
		return sanitizeEvals(run.Status)
	}
	return "incomplete"
}

func evalRunStatusTone(run evalRunItem) color.Color {
	if run.Passed {
		return shell.ColorGreen
	}
	if run.Status == "complete" || run.Status == "failed" {
		return shell.ColorRose
	}
	return shell.ColorAmber
}

func evalCellTone(status string) color.Color {
	switch normalizeEvalCellStatus(status) {
	case "pass":
		return shell.ColorGreen
	case "fail":
		return shell.ColorRose
	default:
		return shell.ColorTextDim
	}
}

func evalCellGlyph(status string) string {
	switch normalizeEvalCellStatus(status) {
	case "pass":
		return shell.Green.Render("■ pass")
	case "fail":
		return shell.Rose.Render("■ fail")
	case "skipped":
		return shell.TextDim.Render("◌ skipped")
	default:
		return shell.TextDim.Render("◌ not-run")
	}
}

func evalScoreTone(_ evalCellScore, gate evalGate, ok bool) color.Color {
	if ok && gate.Passed != nil && !*gate.Passed {
		return shell.ColorRose
	}
	return shell.ColorGreen
}

func padEvalGridCell(value string, width int) string {
	value = kit.Fit(value, width, "…")
	if gap := width - lipgloss.Width(value); gap > 0 {
		value += strings.Repeat(" ", gap)
	}
	return value
}

func formatEvalDuration(ms float64) string {
	if ms >= 1000 {
		return fmt.Sprintf("%.2fs", ms/1000)
	}
	return fmt.Sprintf("%.0fms", ms)
}

func evalRunAge(now time.Time, millis int64) string {
	if millis <= 0 {
		return ""
	}
	duration := now.Sub(time.UnixMilli(millis))
	switch {
	case duration < time.Minute:
		return "now"
	case duration < time.Hour:
		return fmt.Sprintf("%dm", int(duration.Minutes()))
	case duration < 24*time.Hour:
		return fmt.Sprintf("%dh", int(duration.Hours()))
	default:
		return fmt.Sprintf("%dd", int(duration.Hours()/24))
	}
}
