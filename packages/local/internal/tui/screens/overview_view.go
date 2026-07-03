package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (o *Overview) View(size Size) string {
	if !o.loaded {
		return centerMsg(size, "loading overview…")
	}
	if o.err != "" {
		return centerMsg(size, "error: "+o.err)
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

	kpi := panelRect(o.renderKPIStrip(kpiRect.W), kpiRect.W, kpiRect.H)
	left := panelRect(o.renderLeftColumn(leftRect.W, leftRect.H), leftRect.W, leftRect.H)
	right := panelRect(o.renderRightColumn(rightRect.W, rightRect.H), rightRect.W, rightRect.H)

	bodyLines := kit.Compose(
		[]kit.Rect{leftRect, rightRect},
		[][]string{strings.Split(left, "\n"), strings.Split(right, "\n")},
	)
	body := strings.Join(bodyLines, "\n")
	return kpi + "\n" + body
}

func (o *Overview) renderCompact(size Size) string {
	lines := make([]string, 0, size.Height)
	appendBlock := func(block string) {
		lines = append(lines, strings.Split(block, "\n")...)
	}
	appendBlock(shell.PaneHeader(size.Width, "Overview", "", shell.TextMuted.Render("compact")))
	appendBlock(padRow(" "+shell.Text.Render(fmt.Sprintf("insights %d", o.overview.InsightCount))+"  "+shell.TextDim.Render(fmt.Sprintf("%dH %dM %dL", o.overview.OpenInsightSeverityCounts["high"], o.overview.OpenInsightSeverityCounts["medium"], o.overview.OpenInsightSeverityCounts["low"])), size.Width))
	appendBlock(padRow(" "+shell.Text.Render("pass rate")+"  "+shell.Green.Render(percent(o.overview.PassRate)), size.Width))
	appendBlock(padRow(" "+shell.Text.Render("cost / 100")+"  "+shell.Amber.Render(dollars(o.overview.CostPer100Runs)), size.Width))
	appendBlock(padRow(" "+shell.Text.Render("p95 latency")+"  "+shell.Amber.Render(latency(o.overview.P95LatencyMs)), size.Width))
	appendBlock(shell.PaneHeader(size.Width, "Top insight", "", ""))
	if len(o.insights) == 0 {
		appendBlock(padRow(" "+shell.TextMuted.Render("no insights"), size.Width))
	} else {
		ins := o.insights[0]
		appendBlock(padRow(" "+kit.SeverityDot(ins.Severity)+" "+shell.Text.Render(truncate(ins.Title, size.Width-8)), size.Width))
		appendBlock(padRow("   "+shell.TextDim.Render(truncate(ins.Summary, size.Width-4)), size.Width))
	}
	appendBlock(shell.PaneHeader(size.Width, "Recent run", "", ""))
	if runs := o.recentRunsList(); len(runs) > 0 {
		run := runs[0]
		appendBlock(padRow(" "+kit.StatusDot(run.Status)+" "+shell.Text.Render(truncate(run.TraceID, 10))+"  "+shell.TextDim.Render(truncate(run.TargetID, size.Width-18)), size.Width))
	} else {
		appendBlock(padRow(" "+shell.TextMuted.Render("no runs"), size.Width))
	}
	if len(lines) > size.Height {
		lines = lines[:size.Height]
	}
	for len(lines) < size.Height {
		lines = append(lines, strings.Repeat(" ", size.Width))
	}
	return strings.Join(lines, "\n")
}
