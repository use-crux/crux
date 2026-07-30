package screens

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (o *Overview) renderRightColumn(width, height int) string {
	chartH := 11
	if chartH > height/2 {
		chartH = height / 2
	}
	chart := o.renderPassRateChart(width, chartH)
	activityH := height - chartH - 1
	activity := o.renderActivityBlock(width, activityH)
	// PaneHeader supplies the top divider for the activity block — no
	// explicit rule between chart + activity (same reason as the left
	// column's insights/recent-runs pair).
	return chart + "\n" + activity
}

func (o *Overview) renderPassRateChart(width, height int) string {
	header := overviewPaneHeader(width, "Pass rate · last 14 days", "", "run trend")
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH - 1
	if bodyRows < 3 {
		bodyRows = 3
	}
	values := passRateHistory(o.overviewSummary())
	if len(values) == 0 {
		return header + "\n" + padRow(" "+shell.TextMuted.Render("No pass-rate history yet — run `crux eval`."), width)
	}
	// Values are 0-1; show as 0-100. Adapt the y-range to the data so the
	// chart still renders when the backend hasn't seen real pass-rate
	// numbers yet (e.g. all zeros on a fresh project).
	scaled := make([]float64, len(values))
	dataMin, dataMax := 100.0, 0.0
	hasNonZero := false
	for i, v := range values {
		s := v * 100
		scaled[i] = s
		if s > dataMax {
			dataMax = s
		}
		if s < dataMin {
			dataMin = s
		}
		if s != 0 {
			hasNonZero = true
		}
	}
	if !hasNonZero {
		return header + "\n" + padRow(" "+shell.TextMuted.Render("No pass-rate history yet — run `crux eval`."), width)
	}
	yMin, yMax := 80.0, 100.0
	if dataMin < yMin {
		yMin = dataMin - 5
		if yMin < 0 {
			yMin = 0
		}
	}
	if dataMax > yMax {
		yMax = dataMax
	}
	chart := kit.ASCIIChart(scaled, yMin, yMax, len(scaled), bodyRows, "%d%%", 0, false)
	axisRow := renderPassRateAxis(width)
	return header + "\n" + chart + "\n" + axisRow
}

func renderPassRateAxis(width int) string {
	leftLabel := shell.TextMuted.Render("14d ago")
	midLabel := shell.TextMuted.Render("trend")
	rightLabel := shell.TextMuted.Render("now")
	// Account for the 6-col y-axis label gutter that ASCIIChart writes.
	const yGutter = 7
	chartW := width - yGutter
	if chartW < 12 {
		chartW = 12
	}
	leftW := lipgloss.Width(leftLabel)
	midW := lipgloss.Width(midLabel)
	rightW := lipgloss.Width(rightLabel)
	// Center the middle label; pin the others to the chart edges.
	midStart := (chartW - midW) / 2
	leftPad := midStart - leftW
	if leftPad < 1 {
		leftPad = 1
	}
	rightPad := chartW - midStart - midW - rightW
	if rightPad < 1 {
		rightPad = 1
	}
	return strings.Repeat(" ", yGutter) +
		leftLabel + strings.Repeat(" ", leftPad) +
		midLabel + strings.Repeat(" ", rightPad) +
		rightLabel
}

func (o *Overview) renderActivityBlock(width, height int) string {
	snapshot := o.activityResource.Snapshot()
	meta := appendResourceStatus("dev-server · live", resourceStatus(snapshot))
	header := overviewPaneHeader(width, focusTitle("Activity", o.focusedPanel == panelActivity), "", meta)
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	// Filter low-signal events so the feed reads like the design intent
	// (one notable thing per row) rather than dumping every WS frame.
	if !snapshot.HasValue {
		rows := []string{" " + shell.TextMuted.Render(resourceStateMessage(snapshot.State, snapshot.Err, "activity"))}
		for len(rows) < bodyRows {
			rows = append(rows, strings.Repeat(" ", width))
		}
		return header + "\n" + strings.Join(rows, "\n")
	}
	filtered := o.projectedActivityRows()

	rows := make([]string, 0, bodyRows)
	// Empty-state hint when the activity feed has nothing yet — better
	// than rendering blank rows and looking broken. Design intent: the
	// feed is always populated in a live workbench; this hint is the
	// first-30-seconds-of-`crux dev` state.
	if len(filtered) == 0 {
		hint := " " + shell.TextMuted.Render("No activity yet — use your app with `crux dev` running, or run `crux eval`.")
		rows = append(rows, padRow(hint, width))
	}
	start := o.activityScroll
	if start >= len(filtered) {
		start = len(filtered) - 1
	}
	if start < 0 {
		start = 0
	}
	limit := start + bodyRows
	if limit > len(filtered) {
		limit = len(filtered)
	}
	for i := start; i < limit; i++ {
		ev := filtered[i]
		ts := time.UnixMilli(ev.Timestamp).Format("15:04:05")
		dot := lipgloss.NewStyle().Foreground(activityColor(ev.Severity, ev.Kind)).Render("▸")
		row := fmt.Sprintf(" %s  %s  %s",
			shell.TextMuted.Render(ts),
			dot,
			shell.TextDim.Render(truncate(formatActivitySummary(ev), width-16)),
		)
		rows = append(rows, padRow(row, width))
	}
	for len(rows) < bodyRows {
		rows = append(rows, strings.Repeat(" ", width))
	}
	return header + "\n" + strings.Join(rows, "\n")
}

func isNoiseEvent(ev api.InspectActivityEvent) bool {
	s := strings.ToLower(ev.Summary)
	switch {
	case strings.Contains(s, "stream:start"),
		strings.Contains(s, ":progress"),
		strings.Contains(s, "handoff:prepare"):
		return true
	}
	return false
}

func formatActivitySummary(ev api.InspectActivityEvent) string {
	s := ev.Summary
	s = strings.ReplaceAll(s, " for ", " · ")
	s = strings.ReplaceAll(s, "tool:end", "tool done")
	s = strings.ReplaceAll(s, "delegate:complete", "delegate done")
	s = strings.ReplaceAll(s, "runtime-flow:end", "flow done")
	return s
}

func activityColor(severity, kind string) color.Color {
	switch severity {
	case "error":
		return shell.ColorRose
	case "warn":
		return shell.ColorAmber
	}
	switch kind {
	case "insight":
		return shell.ColorViolet
	default:
		return shell.ColorTeal
	}
}
