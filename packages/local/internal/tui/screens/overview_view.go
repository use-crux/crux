package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (o *Overview) View(_ Size) string {
	size := o.size
	if size.Width <= 0 || size.Height <= 0 {
		return ""
	}
	if kit.Classify(size.Width) == kit.LayoutSingle {
		return o.renderCompact(size)
	}

	root := kit.Rect{W: size.Width, H: size.Height}
	rows := kit.SplitV(root, kit.Fixed(5), kit.Fill())
	kpiRect := rows[0]
	bodyRect := rows[1]

	bodyLocal := kit.Rect{W: bodyRect.W, H: bodyRect.H}
	cols := kit.SplitH(bodyLocal, kit.Ratio(3, 5), kit.Fill())
	leftRect := cols[0]
	rightRect := cols[1]

	kpi := strings.Split(panelRect(o.renderKPIState(kpiRect.W, kpiRect.H), kpiRect.W, kpiRect.H), "\n")
	left := strings.Split(panelRect(o.renderLeftColumn(leftRect.W, leftRect.H), leftRect.W, leftRect.H), "\n")
	right := strings.Split(panelRect(o.renderRightColumn(rightRect.W, rightRect.H), rightRect.W, rightRect.H), "\n")

	bodyLines := kit.Compose(
		[]kit.Rect{leftRect, rightRect},
		[][]string{left, right},
	)
	body := strings.Join(bodyLines, "\n")
	return strings.Join(kpi, "\n") + "\n" + body
}

func (o *Overview) renderCompact(size Size) string {
	snapshot := o.summaryResource.Snapshot()
	summary := o.overviewSummary()
	lines := make([]string, 0, size.Height)
	appendBlock := func(block string) {
		lines = append(lines, strings.Split(block, "\n")...)
	}
	meta := appendResourceStatus("compact · h/l pane", resourceStatus(snapshot))
	appendBlock(overviewPaneHeader(size.Width, "Overview", "", meta))
	if !snapshot.HasValue {
		appendBlock(padRow(" "+shell.TextMuted.Render(resourceStateMessage(snapshot.State, snapshot.Err, "overview summary")), size.Width))
	} else if snapshot.State == resource.ResourceEmpty || !overviewSummaryHasData(summary) {
		appendBlock(padRow(" "+shell.TextMuted.Render("No run metrics yet — run `crux eval`, or use your app with `crux dev` running."), size.Width))
	} else {
		appendBlock(padRow(" "+shell.Text.Render(fmt.Sprintf("insights %d", summary.InsightCount))+"  "+shell.TextDim.Render(fmt.Sprintf("%dH %dM %dL", summary.OpenInsightSeverityCounts["high"], summary.OpenInsightSeverityCounts["medium"], summary.OpenInsightSeverityCounts["low"])), size.Width))
		appendBlock(padRow(" "+shell.Text.Render("pass rate")+"  "+shell.Green.Render(percent(summary.PassRate)), size.Width))
		appendBlock(padRow(" "+shell.Text.Render("cost / 100")+"  "+shell.Amber.Render(dollars(summary.CostPer100Runs)), size.Width))
		appendBlock(padRow(" "+shell.Text.Render("p95 latency")+"  "+shell.Amber.Render(latency(summary.P95LatencyMs)), size.Width))
	}
	remaining := max(1, size.Height-len(lines))
	switch o.focusedPanel {
	case panelRuns:
		appendBlock(o.renderRecentRunsBlock(size.Width, remaining))
	case panelActivity:
		appendBlock(o.renderActivityBlock(size.Width, remaining))
	default:
		appendBlock(o.renderInsightsBlock(size.Width, remaining))
	}
	if len(lines) > size.Height {
		lines = lines[:size.Height]
	}
	for len(lines) < size.Height {
		lines = append(lines, strings.Repeat(" ", size.Width))
	}
	if len(lines) > 0 {
		lines[len(lines)-1] = padRow(" "+shell.TextMuted.Render(o.compactPosition()), size.Width)
	}
	return kit.PadBlock(strings.Join(lines, "\n"), size.Width, size.Height)
}

func (o *Overview) compactPosition() string {
	switch o.focusedPanel {
	case panelRuns:
		return overviewListPosition("run", o.runList.Position()) + " · j/k move · h/l pane"
	case panelActivity:
		total := len(o.projectedActivityRows())
		current := 0
		if total > 0 {
			current = o.activityScroll + 1
		}
		return fmt.Sprintf("activity %d/%d · j/k scroll · h/l pane", current, total)
	default:
		return overviewListPosition("insight", o.insightList.Position()) + " · j/k move · h/l pane"
	}
}

func overviewListPosition(label string, position kit.ListPosition) string {
	current := 0
	if position.Total > 0 && position.SelectedIndex >= 0 {
		current = position.SelectedIndex + 1
	}
	return fmt.Sprintf("%s %d/%d", label, current, position.Total)
}

func (o *Overview) renderKPIState(width, height int) string {
	snapshot := o.summaryResource.Snapshot()
	if !snapshot.HasValue {
		return centerMsg(Size{Width: width, Height: height}, resourceStateMessage(snapshot.State, snapshot.Err, "overview summary"))
	}
	if snapshot.State == resource.ResourceEmpty || !overviewSummaryHasData(o.overviewSummary()) {
		return centerMsg(Size{Width: width, Height: height}, "No run metrics yet — run `crux eval`, or use your app with `crux dev` running.")
	}
	view := o.renderKPIStrip(width)
	status := resourceStatus(snapshot)
	if status == "" {
		return view
	}
	lines := strings.Split(view, "\n")
	if len(lines) > 0 {
		lines[0] = padRow(" "+shell.Amber.Render(truncate(status, max(0, width-2))), width)
	}
	return strings.Join(lines, "\n")
}

func overviewSummaryHasData(summary api.InspectOverviewRecord) bool {
	return summary.RunCount > 0
}
