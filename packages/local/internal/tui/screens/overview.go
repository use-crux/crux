package screens

import (
	"context"
	"fmt"
	"image/color"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Overview screen: 4-column KPI strip, top-insights queue, recent runs,
// 14-day pass-rate ASCII chart, live activity log.
type Overview struct {
	overview api.QualityOverviewRecord
	insights []api.QualityInsightRecord
	runs     []api.QualityRunRecord
	activity []api.QualityActivityEvent
	loaded   bool
	err      string

	// Cross-pane cursor state. Overview is the workflow launchpad — j/k
	// moves a cursor through the focused panel; h/l toggles the focused
	// panel between Top Insights and Recent Runs. See S6 in the plan.
	focusedPanel overviewPanel
	insightCur   int
	runCur       int
	insightList  kit.VList[api.QualityInsightRecord]
	runList      kit.VList[api.QualityRunRecord]
}

type overviewPanel int

const (
	panelInsights overviewPanel = iota
	panelRuns
)

// SelectedInsightID returns the InsightID of the cursor-focused Top
// Insights row, or "" if no insights are loaded.
func (o *Overview) SelectedInsightID() string {
	if o.insightCur < 0 || o.insightCur >= len(o.insights) {
		return ""
	}
	return o.insights[o.insightCur].InsightID
}

// SelectedRunID returns the TraceID of the cursor-focused Recent Runs
// row, or "" if no runs are loaded.
func (o *Overview) SelectedRunID() string {
	runs := o.recentRunsList()
	if o.runCur < 0 || o.runCur >= len(runs) {
		return ""
	}
	return runs[o.runCur].TraceID
}

// recentRunsList resolves the right source for the runs panel — the
// overview-embedded list if present, otherwise the recent-runs fallback.
func (o *Overview) recentRunsList() []api.QualityRunRecord {
	if len(o.overview.RecentRuns) > 0 {
		return o.overview.RecentRuns
	}
	return o.runs
}

// NewOverview constructs an empty Overview screen.
func NewOverview() *Overview {
	o := &Overview{}
	o.insightList.SetIdentity(func(ins api.QualityInsightRecord) string { return ins.InsightID })
	o.runList.SetIdentity(func(run api.QualityRunRecord) string { return run.TraceID })
	return o
}

func (o *Overview) ID() string { return "overview" }

func (o *Overview) Interested(domains bridge.Domains) bool {
	return domains.Intersects(bridge.NewDomains(
		bridge.DomainRuns,
		bridge.DomainInsights,
		bridge.DomainExperiments,
		bridge.DomainBaselines,
		bridge.DomainFeedback,
		bridge.DomainCassettes,
		bridge.DomainActivity,
	))
}

func (o *Overview) Init(client DataClient) tea.Cmd {
	return tea.Batch(
		fetchOverview(client),
		fetchInsights(client),
		fetchRuns(client),
		fetchActivity(client, 12),
	)
}

func (o *Overview) Update(msg tea.Msg, client DataClient) tea.Cmd {
	switch m := msg.(type) {
	case overviewLoadedMsg:
		o.overview = api.QualityOverviewRecord(m.rec)
		o.loaded = true
		o.syncLists()
	case insightsLoadedMsg:
		o.insights = []api.QualityInsightRecord(m)
		o.syncLists()
	case runsLoadedMsg:
		o.runs = []api.QualityRunRecord(m)
		o.syncLists()
	case activityLoadedMsg:
		o.activity = []api.QualityActivityEvent(m)
	case dataErrMsg:
		o.err = string(m)
	case api.QualityEvent:
		// A typed event arrived from the bus. Optimistically prepend it as
		// an activity row + re-fetch in the background.
		o.activity = prependActivity(o.activity, activityFromEvent(m), 12)
		return tea.Batch(
			fetchOverview(client),
			fetchActivity(client, 12),
		)
	case tea.KeyPressMsg:
		return o.handleKey(m)
	}
	return nil
}

// handleKey owns the navigable-Overview keymap. j/k cycles within the
// focused panel; h/l toggles focus between Top Insights and Recent Runs.
// See S6 in the implementation plan.
func (o *Overview) handleKey(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "j", "down":
		o.moveCursor(+1)
	case "k", "up":
		o.moveCursor(-1)
	case "h", "left":
		o.focusedPanel = panelInsights
	case "l", "right":
		o.focusedPanel = panelRuns
	case "enter":
		return o.drill()
	}
	return nil
}

// drill returns a tea.Cmd that emits a NavigateRequest based on the
// focused panel + cursor — the workbench picks it up, stages the id in
// the cross-screen selection store, and jumps to the destination screen.
// See ADR-0051. If no record is focused (empty list), returns nil.
func (o *Overview) drill() tea.Cmd {
	var req NavigateRequest
	switch o.focusedPanel {
	case panelInsights:
		id := o.SelectedInsightID()
		if id == "" {
			return nil
		}
		req = NavigateRequest{NavID: "insights", Kind: "insight", ID: id}
	case panelRuns:
		id := o.SelectedRunID()
		if id == "" {
			return nil
		}
		req = NavigateRequest{NavID: "runs", Kind: "run", ID: id}
	default:
		return nil
	}
	return func() tea.Msg { return req }
}

func (o *Overview) moveCursor(delta int) {
	switch o.focusedPanel {
	case panelInsights:
		o.insightList.SetItems(o.insights)
		o.insightList.SetCursorByIdentity(o.SelectedInsightID())
		if delta > 0 {
			o.insightList.CursorDown()
		} else {
			o.insightList.CursorUp()
		}
		_, idx, ok := o.insightList.Cursor()
		if ok {
			o.insightCur = idx
		}
	case panelRuns:
		runs := o.recentRunsList()
		o.runList.SetItems(runs)
		o.runList.SetCursorByIdentity(o.SelectedRunID())
		if delta > 0 {
			o.runList.CursorDown()
		} else {
			o.runList.CursorUp()
		}
		_, idx, ok := o.runList.Cursor()
		if ok {
			o.runCur = idx
		}
	}
}

func (o *Overview) syncLists() {
	o.insightList.SetItems(o.insights)
	if o.insightCur < len(o.insights) {
		o.insightList.SetCursorByIdentity(o.SelectedInsightID())
	}
	runs := o.recentRunsList()
	o.runList.SetItems(runs)
	if o.runCur < len(runs) {
		o.runList.SetCursorByIdentity(o.SelectedRunID())
	}
}

func activityFromEvent(ev api.QualityEvent) api.QualityActivityEvent {
	summary := ev.Action
	if ev.Kind != "" {
		summary = ev.Kind + " " + ev.RefID
	}
	return api.QualityActivityEvent{
		Tag:       "QualityActivityEvent",
		Timestamp: ev.Timestamp,
		Kind:      ev.Kind,
		Severity:  ev.Severity,
		Summary:   summary,
		RefID:     ev.RefID,
	}
}

func prependActivity(existing []api.QualityActivityEvent, ev api.QualityActivityEvent, limit int) []api.QualityActivityEvent {
	out := append([]api.QualityActivityEvent{ev}, existing...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func (o *Overview) Breadcrumb() ([]string, string) {
	return []string{"overview"}, ""
}

func (o *Overview) Keybinds() []shell.Keybind {
	// Overview is read-only — no selection state, no row-level actions. The
	// hints below are the nav shortcuts that work everywhere.
	return []shell.Keybind{
		{Key: "g i", Label: "insights"},
		{Key: "g r", Label: "runs"},
		{Key: "g x", Label: "experiments"},
		{Key: "g s", Label: "suites"},
		{Key: ":", Label: "cmd"},
		{Key: "?", Label: "help"},
		{Key: "q", Label: "quit"},
	}
}

func (o *Overview) Counts() map[string]int {
	return map[string]int{
		"insights":    o.overview.InsightCount,
		"runs":        o.overview.RunCount,
		"experiments": o.overview.ExperimentCount,
		"baselines":   o.overview.BaselineCount,
		"feedback":    o.overview.FeedbackCount,
		"cassettes":   o.overview.CassetteCount,
	}
}

func (o *Overview) View(size Size) string {
	if !o.loaded {
		return centerMsg(size, "loading overview…")
	}
	if o.err != "" {
		return centerMsg(size, "error: "+o.err)
	}
	if size.Width < 120 {
		return o.renderCompact(size)
	}

	kpi := o.renderKPIStrip(size.Width)
	kpiLines := strings.Count(kpi, "\n") + 1
	bodyH := size.Height - kpiLines - 1
	if bodyH < 8 {
		bodyH = 8
	}

	leftW := size.Width * 58 / 100
	rightW := size.Width - leftW - 1 // 1 for the vertical border

	left := panelRect(o.renderLeftColumn(leftW, bodyH), leftW, bodyH)
	right := panelRect(o.renderRightColumn(rightW, bodyH), rightW, bodyH)

	body := kit.ComposeColumns(
		kit.PadBlock(left, leftW, bodyH),
		kit.PadBlock(right, rightW, bodyH),
	)
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
		fmtBaselineDelta(o.overview.LatestExperimentPassRate, o.overview.PassRate),
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

func (o *Overview) renderLeftColumn(width, height int) string {
	insightsH := height * 54 / 100
	if insightsH > 16 {
		insightsH = 16
	}
	if insightsH < 10 {
		insightsH = 10
	}
	runsH := height - insightsH - 1
	insights := o.renderInsightsBlock(width, insightsH)
	runs := o.renderRecentRunsBlock(width, runsH)
	// No explicit divider between the two sub-panes — PaneHeader now
	// owns top + bottom borders, so the "Recent runs" header brings
	// its own separator. Inserting one here would double up the rule.
	return insights + "\n" + runs
}

func (o *Overview) renderInsightsBlock(width, height int) string {
	header := shell.PaneHeader(width, "Top insights", "",
		shell.TextMuted.Render(fmt.Sprintf("%d open · sorted: severity ↓", len(o.insights))))
	hdrH := strings.Count(header, "\n") + 1

	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	if len(o.insights) == 0 {
		hint := " " + shell.TextMuted.Render("no insights yet — run an experiment or wait for the analyzer.")
		rows := []string{hint}
		for len(rows) < bodyRows {
			rows = append(rows, strings.Repeat(" ", width))
		}
		return header + "\n" + strings.Join(rows, "\n")
	}

	o.insightList.SetItems(o.insights)
	o.insightList.SetHeight(bodyRows)
	o.insightList.SetCursorByIdentity(o.SelectedInsightID())
	rows := o.insightList.Render(width, func(ins api.QualityInsightRecord, _ int, selected bool, rowW int) string {
		// Row 1: bar + severity dot + ID + tag chip + title + target + age.
		bar := "  "
		if selected {
			bar = shell.SelectionBar(shell.SeverityColor(ins.Severity)) + " "
		}
		sev := kit.SeverityDot(ins.Severity)
		id := shell.TextMuted.Render(padString3(truncate(ins.InsightID, 7), 7))
		tag := ""
		if len(ins.Tags) > 0 {
			tag = shell.Teal.Render(padString3(truncate(ins.Tags[0], 12), 12))
		} else {
			tag = strings.Repeat(" ", 12)
		}
		target := shell.TextDim.Render(padString3(truncate(ins.TargetID, 12), 12))
		ago := shell.TextMuted.Render(padString3(relTime(ins.UpdatedAt), 4))

		// Sparkline column on the right; trim title accordingly.
		sk := ""
		if len(ins.Trend) > 0 {
			sk = kit.Sparkline(ins.Trend, 6, shell.SeverityColor(ins.Severity))
		}
		skW := lipgloss.Width(sk)

		titleBudget := rowW - 8 - 7 - 13 - 13 - 5 - skW - 6
		if titleBudget < 12 {
			titleBudget = 12
		}
		title := shell.Text.Render(padString3(truncate(ins.Title, titleBudget), titleBudget))

		line1Parts := []string{bar, sev, " ", id, " ", tag, " ", title, " ", target, " ", ago}
		if sk != "" {
			line1Parts = append(line1Parts, "  ", sk)
		}
		line1 := strings.Join(line1Parts, "")

		return padRow(line1, rowW)
	})
	for len(rows) < bodyRows {
		rows = append(rows, strings.Repeat(" ", width))
	}
	return header + "\n" + strings.Join(rows, "\n")
}

func (o *Overview) renderRecentRunsBlock(width, height int) string {
	runs := o.overview.RecentRuns
	if len(runs) == 0 {
		runs = o.runs
	}
	header := shell.PaneHeader(width, "Recent runs", "",
		shell.TextMuted.Render(recentRunsMeta(runs)))
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}
	o.runList.SetItems(runs)
	o.runList.SetHeight(bodyRows)
	o.runList.SetCursorByIdentity(o.SelectedRunID())
	rows := o.runList.Render(width, func(r api.QualityRunRecord, _ int, selected bool, rowW int) string {
		prefix := " "
		if selected && o.focusedPanel == panelRuns {
			prefix = shell.SelectionBar(shell.ColorTeal) + " "
		}
		dot := kit.StatusDot(r.Status)
		id := shortID(r.TraceID, 7)
		target := truncate(r.TargetID, 14)
		lat := durStr(r.DurationMs)
		tok := formatTokensShort(r.TokenCount)
		ago := relTimeUnix(r.StartedAt)
		// Single-line row matching the design's run/<id> <target> <lat>·<tok> tok … <ago>
		row := fmt.Sprintf("%s%s  %s  %s   %s · %s tok",
			prefix,
			dot,
			shell.Text.Render(padString3("run/"+id, 16)),
			shell.TextDim.Render(padString3(target, 14)),
			shell.TextDim.Render(padString3(lat, 7)),
			shell.TextDim.Render(padString3(tok, 6)),
		)
		// Right-align age.
		rightStr := shell.TextMuted.Render(ago)
		used := lipgloss.Width(row)
		pad := rowW - used - lipgloss.Width(rightStr) - 1
		if pad < 1 {
			pad = 1
		}
		row = row + strings.Repeat(" ", pad) + rightStr + " "
		return padRow(row, rowW)
	})
	if len(runs) == 0 {
		rows = append(rows, " "+shell.TextMuted.Render("no runs yet — start a flow or prompt to see traces here."))
	}
	for len(rows) < bodyRows {
		rows = append(rows, strings.Repeat(" ", width))
	}
	return header + "\n" + strings.Join(rows, "\n")
}

func padString3(s string, width int) string {
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

// panelRect pads `body` to `width × height`. Previously this wrapped
// every line in `Background(ColorPanel)` — which painted the entire
// Overview as a series of panel-tinted boxes against the default bg.
// The design has the KPI cells, insights list, and chart sitting on
// the same body bg, separated only by the vertical/horizontal dividers
// already rendered by Compose / horizontalRuleDim.
func panelRect(body string, width, height int) string {
	return kit.PadBlock(body, width, height)
}

func recentRunsMeta(runs []api.QualityRunRecord) string {
	if len(runs) == 0 {
		return "no runs"
	}
	newest := int64(0)
	oldest := int64(0)
	for _, r := range runs {
		if r.StartedAt == 0 {
			continue
		}
		if newest == 0 || r.StartedAt > newest {
			newest = r.StartedAt
		}
		if oldest == 0 || r.StartedAt < oldest {
			oldest = r.StartedAt
		}
	}
	window := "recent"
	if newest > 0 && oldest > 0 {
		d := time.UnixMilli(newest).Sub(time.UnixMilli(oldest))
		switch {
		case d < time.Hour:
			window = "last 1h"
		case d < 24*time.Hour:
			window = fmt.Sprintf("last %dh", int(d.Hours())+1)
		default:
			window = fmt.Sprintf("last %dd", int(d.Hours()/24)+1)
		}
	}
	return fmt.Sprintf("%s · %d runs", window, len(runs))
}

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
	header := shell.PaneHeader(width, "Pass rate · last 14 days", "", shell.TextMuted.Render("vs baseline"))
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH - 1
	if bodyRows < 3 {
		bodyRows = 3
	}
	values := passRateHistory(o.overview)
	if len(values) == 0 {
		return header + "\n" + shell.TextMuted.Render(" no history yet — run an experiment to populate")
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
		return header + "\n" + shell.TextMuted.Render(" pass rate history is empty — run a suite to populate")
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
	chart := kit.ASCIIChart(scaled, yMin, yMax, len(scaled), bodyRows, "%d%%", 96, false)
	// X-axis legend matching the design: `14d ago   baseline = N%   now`.
	// Three labels distributed left / center / right under the chart.
	axisRow := renderPassRateAxis(width, o.overview.LatestExperimentPassRate)
	return header + "\n" + chart + "\n" + axisRow
}

// renderPassRateAxis renders the `14d ago    baseline = N%    now` row
// under the pass-rate chart. Three labels, dim grey, evenly distributed
// across the chart width.
func renderPassRateAxis(width int, baseline *float64) string {
	leftLabel := shell.TextMuted.Render("14d ago")
	midLabel := shell.TextMuted.Render("baseline")
	if baseline != nil {
		midLabel = shell.TextMuted.Render(fmt.Sprintf("baseline = %.0f%%", *baseline*100))
	}
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
	header := shell.PaneHeader(width, "Activity", "", shell.TextMuted.Render("dev-server · live"))
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	// Filter low-signal events so the feed reads like the design intent
	// (one notable thing per row) rather than dumping every WS frame.
	filtered := make([]api.QualityActivityEvent, 0, len(o.activity))
	var lastKey string
	for _, ev := range o.activity {
		if isNoiseEvent(ev) {
			continue
		}
		// Collapse adjacent duplicates (same kind+refId).
		key := ev.Kind + "|" + ev.RefID
		if key != "" && key == lastKey {
			continue
		}
		lastKey = key
		filtered = append(filtered, ev)
	}

	rows := make([]string, 0, bodyRows)
	// Empty-state hint when the activity feed has nothing yet — better
	// than rendering blank rows and looking broken. Design intent: the
	// feed is always populated in a live workbench; this hint is the
	// first-30-seconds-of-`crux dev` state.
	if len(filtered) == 0 {
		hint := " " + shell.TextMuted.Render("idle · waiting for runs, experiments, and feedback")
		rows = append(rows, padRow(hint, width))
	}
	limit := bodyRows
	if limit > len(filtered) {
		limit = len(filtered)
	}
	for i := 0; i < limit; i++ {
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

// isNoiseEvent filters streaming progress and other sub-second updates that
// would otherwise dominate the activity feed.
func isNoiseEvent(ev api.QualityActivityEvent) bool {
	s := strings.ToLower(ev.Summary)
	switch {
	case strings.Contains(s, "stream:start"),
		strings.Contains(s, ":progress"),
		strings.Contains(s, "handoff:prepare"):
		return true
	}
	return false
}

// formatActivitySummary trims backend boilerplate so rows read tightly.
//
//	"run complete for 1778…3zv2zj" → "run complete · 1778…3zv2zj"
func formatActivitySummary(ev api.QualityActivityEvent) string {
	s := ev.Summary
	s = strings.ReplaceAll(s, " for ", " · ")
	s = strings.ReplaceAll(s, "tool:end", "tool done")
	s = strings.ReplaceAll(s, "delegate:complete", "delegate done")
	s = strings.ReplaceAll(s, "runtime-flow:end", "flow done")
	return s
}

// --- helpers -----------------------------------------------------------------

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

func passRateSpark(rec api.QualityOverviewRecord) []float64 {
	return passRateHistory(rec)
}

func passRateHistory(rec api.QualityOverviewRecord) []float64 {
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

// shortID returns the first n characters of an identifier with no
// ellipsis — used for run/trace/span ids where the design shows a
// stable short-sha-style label (e.g. `8af2f1c`) rather than a
// truncated-with-ellipsis form (`8af2f1…`). Identifiers are stable
// hashes; the ellipsis is misleading noise.
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

var relTimeNow = time.Now

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

func activityColor(severity, kind string) color.Color {
	switch severity {
	case "error":
		return shell.ColorRose
	case "warn":
		return shell.ColorAmber
	}
	switch kind {
	case "experiment":
		return shell.ColorViolet
	case "insight":
		return shell.ColorViolet
	case "feedback":
		return shell.ColorTextDim
	default:
		return shell.ColorTeal
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

// --- fetch commands ----------------------------------------------------------

type overviewLoadedMsg struct{ rec api.QualityOverviewRecord }
type insightsLoadedMsg []api.QualityInsightRecord
type runsLoadedMsg []api.QualityRunRecord
type activityLoadedMsg []api.QualityActivityEvent
type dataErrMsg string

func fetchOverview(c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Overview(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return overviewLoadedMsg{rec: rec}
	}
}

func fetchInsights(c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Insights(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightsLoadedMsg(rec)
	}
}

func fetchRuns(c DataClient) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Runs(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return runsLoadedMsg(rec)
	}
}

func fetchActivity(c DataClient, limit int) tea.Cmd {
	return func() tea.Msg {
		rec, err := c.Activity(context.Background(), limit)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return activityLoadedMsg(rec)
	}
}
