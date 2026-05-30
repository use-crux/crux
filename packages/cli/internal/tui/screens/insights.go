package screens

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/tui/components"
	"github.com/anthropics/crux-cli/internal/tui/shell"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Insights screen — canonical 2-pane shape:
//
//	list (severity · id · tag · title · target · traces · sparkline · age)
//	│
//	detail (chips · headline · pattern · stats · proposed fix · actions)
type Insights struct {
	items      []api.QualityInsightRecord
	selectedID string
	scroll     int
	loaded     bool
	err        string
	tab        string // diagnosis | traces | cases | compare | fix
}

func NewInsights() *Insights { return &Insights{tab: "diagnosis"} }

func (s *Insights) ID() string { return "insights" }

func (s *Insights) Init(client DataClient) tea.Cmd {
	return fetchInsightsList(client)
}

func (s *Insights) Update(msg tea.Msg, client DataClient) tea.Cmd {
	switch m := msg.(type) {
	case insightsListLoadedMsg:
		s.items = []api.QualityInsightRecord(m)
		if s.selectedID == "" && len(s.items) > 0 {
			s.selectedID = s.items[0].InsightID
		}
		s.loaded = true
	case api.QualityEvent:
		// Live refresh on any store/event change.
		return fetchInsightsList(client)
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyMsg:
		switch m.String() {
		case "j", "down":
			s.moveSelection(1)
		case "k", "up":
			s.moveSelection(-1)
		case "shift+tab":
			s.cycleTab(-1)
		case "tab":
			s.cycleTab(1)
		case "x":
			return s.dismiss(client)
		case "f":
			return s.markFixed(client)
		case "t":
			return s.openLinkedTrace()
		case "s":
			return s.saveCasesStub()
		case "r":
			return s.runVariantStub()
		case "c":
			return s.compareStub()
		case "p":
			return s.promoteFixStub()
		case "e":
			return s.exportInsight()
		case "o":
			// External-viewer stub.
			return nil
		}
	}
	return nil
}

// openLinkedTrace emits a NavigateRequest to the Runs screen with
// the first linked trace staged. Layer-3 screen-local per plan S14.
func (s *Insights) openLinkedTrace() tea.Cmd {
	cur := s.currentInsight()
	if cur == nil || len(cur.LinkedTraceIDs) == 0 {
		return nil
	}
	runID := cur.LinkedTraceIDs[0]
	return func() tea.Msg {
		return NavigateRequest{NavID: "runs", Kind: "run", ID: runID}
	}
}

// saveCasesStub is the placeholder until the multi-select picker
// (Insight's `s save N cases`) lands. Returns non-nil so the keystroke
// produces an effect for the activity feed.
func (s *Insights) saveCasesStub() tea.Cmd {
	cur := s.currentInsight()
	if cur == nil {
		return nil
	}
	id := cur.InsightID
	return func() tea.Msg { return insightSaveCasesPendingMsg{insightID: id} }
}

// runVariantStub is the placeholder until `RerunCase` lands.
func (s *Insights) runVariantStub() tea.Cmd {
	cur := s.currentInsight()
	if cur == nil {
		return nil
	}
	id := cur.InsightID
	return func() tea.Msg { return insightRunVariantPendingMsg{insightID: id} }
}

// compareStub is the placeholder until matching-experiment resolution
// is wired (and CreateComparison is called with the resolved sides).
func (s *Insights) compareStub() tea.Cmd {
	cur := s.currentInsight()
	if cur == nil {
		return nil
	}
	id := cur.InsightID
	return func() tea.Msg { return insightComparePendingMsg{insightID: id} }
}

// promoteFixStub is the placeholder until `StartExperiment` lands.
func (s *Insights) promoteFixStub() tea.Cmd {
	cur := s.currentInsight()
	if cur == nil {
		return nil
	}
	id := cur.InsightID
	return func() tea.Msg { return insightPromoteFixPendingMsg{insightID: id} }
}

// exportInsight writes the focused insight to
// ~/.crux/exports/insight-{id}.json.
func (s *Insights) exportInsight() tea.Cmd {
	cur := s.currentInsight()
	if cur == nil {
		return nil
	}
	rec := *cur
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return dataErrMsg(err.Error())
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return dataErrMsg(err.Error())
		}
		path := filepath.Join(dir, "insight-"+truncate(rec.InsightID, 32)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return insightExportedMsg{insightID: rec.InsightID, path: path}
	}
}

type (
	insightSaveCasesPendingMsg   struct{ insightID string }
	insightRunVariantPendingMsg  struct{ insightID string }
	insightComparePendingMsg     struct{ insightID string }
	insightPromoteFixPendingMsg  struct{ insightID string }
	insightExportedMsg           struct{ insightID, path string }
)

// dismiss sets the active insight's status to `dismissed` via the in-process
// quality service.
func (s *Insights) dismiss(client DataClient) tea.Cmd {
	cur := s.currentInsight()
	if cur == nil {
		return nil
	}
	id := cur.InsightID
	return func() tea.Msg {
		_, err := client.SetInsightStatus(context.Background(), id,
			api.QualityInsightStatusRequest{Status: "dismissed"})
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightStatusMsg{id: id, status: "dismissed"}
	}
}

// markFixed marks the active insight as resolved.
func (s *Insights) markFixed(client DataClient) tea.Cmd {
	cur := s.currentInsight()
	if cur == nil {
		return nil
	}
	id := cur.InsightID
	return func() tea.Msg {
		_, err := client.SetInsightStatus(context.Background(), id,
			api.QualityInsightStatusRequest{Status: "resolved"})
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightStatusMsg{id: id, status: "resolved"}
	}
}

type insightStatusMsg struct {
	id     string
	status string
}

func (s *Insights) Breadcrumb() ([]string, string) {
	path := []string{"insights"}
	if s.selectedID != "" {
		path = append(path, s.selectedID)
	}
	right := ""
	if s.loaded {
		right = fmt.Sprintf("filter: severity ≥ low · %d of %d shown", len(s.items), len(s.items))
	}
	return path, right
}

func (s *Insights) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		{"j/k", "move"}, {"tab", "section"},
		{"t", "linked traces"}, {"s", "save cases"},
		{"r", "run variant"}, {"c", "compare"},
		{"p", "promote fix"}, {"f", "mark fixed"},
		{"x", "dismiss"}, {"e", "export"},
		{"o", "open in viewer"},
		{":", "cmd"}, {"?", "help"},
	}
}

func (s *Insights) Counts() map[string]int {
	open := 0
	for _, it := range s.items {
		if it.Status != "dismissed" && it.Status != "resolved" {
			open++
		}
	}
	return map[string]int{"insights": open}
}

func (s *Insights) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading insights…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no insights yet — collect more traces, run an experiment, or wait for the analyzer.")
	}

	leftW := size.Width * 42 / 100
	if leftW < 50 {
		leftW = 50
	}
	rightW := size.Width - leftW - 1

	left := s.renderList(leftW, size.Height)
	right := s.renderDetail(rightW, size.Height)

	return shell.Compose(
		shell.PadColumnHeight(left, leftW, size.Height),
		shell.PadColumnHeight(right, rightW, size.Height),
	)
}

// --- list pane ---------------------------------------------------------------

func (s *Insights) renderList(width, height int) string {
	high, med, low := 0, 0, 0
	for _, it := range s.items {
		switch it.Severity {
		case "high":
			high++
		case "medium":
			med++
		default:
			low++
		}
	}
	right := shell.Rose.Render(fmt.Sprintf("%d high", high)) + " " +
		shell.Amber.Render(fmt.Sprintf("%d med", med)) + " " +
		shell.TextDim.Render(fmt.Sprintf("%d low", low))

	header := shell.PaneHeader(width, "Insights", fmt.Sprintf("%d open", len(s.items)), right)
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	if bodyRows < 1 {
		bodyRows = 1
	}

	visible := bodyRows
	if visible > len(s.items) {
		visible = len(s.items)
	}
	start := s.scroll
	if start < 0 {
		start = 0
	}
	if start+visible > len(s.items) {
		start = len(s.items) - visible
		if start < 0 {
			start = 0
		}
	}

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	for i := start; i < start+visible; i++ {
		b.WriteString(s.renderListRow(s.items[i], width, s.items[i].InsightID == s.selectedID))
		b.WriteString("\n")
	}
	// Pad remaining rows.
	for i := visible; i < bodyRows; i++ {
		b.WriteString(strings.Repeat(" ", width))
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Insights) renderListRow(it api.QualityInsightRecord, width int, selected bool) string {
	sev := components.SeverityDot(it.Severity)
	id := shell.TextMuted.Render(truncate(it.InsightID, 8))
	tag := ""
	if len(it.Tags) > 0 {
		tag = shell.Teal.Render(truncate(it.Tags[0], 12))
	}
	target := shell.TextDim.Render(truncate(it.TargetID, 12))
	traces := shell.TextMuted.Render(fmt.Sprintf("%d t", len(it.LinkedTraceIDs)))

	titleColor := shell.ColorText
	bg := lipgloss.NoColor{}
	leftBar := " "
	if selected {
		titleColor = shell.ColorTeal
		bg = lipgloss.NoColor{}
		leftBar = lipgloss.NewStyle().Foreground(shell.SeverityColor(it.Severity)).Render("▌")
	}
	title := lipgloss.NewStyle().Foreground(titleColor).Render(truncate(it.Title, width-44))

	spark := ""
	if it.DetailStats != nil && len(it.DetailStats.TokensSpark) > 0 {
		spark = components.Sparkline(it.DetailStats.TokensSpark, 8, shell.SeverityColor(it.Severity))
	}

	line1 := fmt.Sprintf("%s%s %s  %s  %s", leftBar, sev, id, tag, title)
	line2 := fmt.Sprintf("          %s · %s  %s",
		target, traces, shell.TextMuted.Render(relTime(it.UpdatedAt)),
	)
	if spark != "" {
		line2 += "  " + spark
	}

	row1 := padRow(line1, width)
	row2 := padRow(line2, width)
	out := row1 + "\n" + row2
	_ = bg
	return out
}

// --- detail pane -------------------------------------------------------------

func (s *Insights) renderDetail(width, height int) string {
	current := s.currentInsight()
	if current == nil {
		return centerMsg(Size{Width: width, Height: height}, "select an insight")
	}

	// Header: chips + headline. Severity uses the filled pill; tags use
	// the muted ChipTag style.
	sev := shell.SeverityColor(current.Severity)
	chips := components.Chip(current.Severity, sev)
	for i, tag := range current.Tags {
		if i >= 3 {
			break
		}
		chips += "  " + components.ChipDim(tag)
	}
	meta := shell.TextMuted.Render(fmt.Sprintf("%s · updated %s · %d occurrences",
		current.InsightID, relTime(current.UpdatedAt), current.OccurrenceCount))

	chipLine := chips + strings.Repeat(" ", maxInt(1, width-lipgloss.Width(chips)-lipgloss.Width(meta)-2)) + meta
	headline := lipgloss.NewStyle().Foreground(shell.ColorText).Bold(true).Render(current.Title)
	summary := shell.TextDim.Render(wrap(current.Summary, width-2))

	// Tab strip.
	tabs := s.renderTabs(width)

	var bodyBuilder strings.Builder
	bodyBuilder.WriteString(" " + chipLine)
	bodyBuilder.WriteString("\n ")
	bodyBuilder.WriteString(headline)
	bodyBuilder.WriteString("\n ")
	bodyBuilder.WriteString(summary)
	bodyBuilder.WriteString("\n")
	bodyBuilder.WriteString(horizontalRuleDim(width))
	bodyBuilder.WriteString("\n")
	bodyBuilder.WriteString(tabs)
	bodyBuilder.WriteString("\n")
	bodyBuilder.WriteString(horizontalRuleDim(width))
	bodyBuilder.WriteString("\n")
	bodyBuilder.WriteString(s.renderTabBody(*current, width))

	footer := shell.PaneFooter(width, []shell.Keybind{
		{"t", "traces"}, {"s", "save cases"}, {"r", "run variant"},
		{"c", "compare"}, {"p", "promote fix"}, {"x", "dismiss"},
	})
	bodyHeight := height - strings.Count(footer, "\n") - 1
	body := shell.PadColumnHeight(bodyBuilder.String(), width, bodyHeight)
	return body + "\n" + footer
}

func (s *Insights) renderTabs(width int) string {
	tabs := []string{"diagnosis", "traces", "cases", "compare", "fix"}
	var b strings.Builder
	for _, t := range tabs {
		sel := t == s.tab
		style := lipgloss.NewStyle().Foreground(shell.ColorTextDim).Padding(0, 2)
		if sel {
			style = lipgloss.NewStyle().Foreground(shell.ColorTeal).Padding(0, 2).Underline(true)
		}
		b.WriteString(style.Render(t))
	}
	return padRow(" "+b.String(), width)
}

func (s *Insights) renderTabBody(ins api.QualityInsightRecord, width int) string {
	switch s.tab {
	case "traces":
		return s.renderTracesTab(ins, width)
	case "cases":
		return s.renderCasesTab(ins, width)
	case "compare":
		return s.renderCompareTab(ins, width)
	case "fix":
		return s.renderFixTab(ins, width)
	default:
		return s.renderDiagnosisTab(ins, width)
	}
}

func (s *Insights) renderDiagnosisTab(ins api.QualityInsightRecord, width int) string {
	var b strings.Builder
	b.WriteString(" " + shell.SectionTag.Render("PATTERN"))
	b.WriteString("\n")
	pattern := ins.SuspectedCause
	if pattern == "" {
		pattern = "(no pattern detected)"
	}
	b.WriteString(boxedPre(pattern, width-2))
	b.WriteString("\n\n")

	if ds := ins.DetailStats; ds != nil {
		colW := (width - 6) / 3
		stat1 := s.renderStatCard("Tokens / run", fmt.Sprintf("%.1fk", ds.TokensPerRun/1000), ds.TokensDeltaVsBaseline, ds.TokensSpark, colW)
		stat2 := s.renderStatCard("Latency p95", latencyMs(ds.LatencyP95Ms), ds.LatencyDeltaVsBaseline, ds.LatencySpark, colW)
		stat3 := s.renderStatCard("Cost / 100", fmt.Sprintf("$%.2f", ds.CostPer100), ds.CostDeltaVsBaseline, ds.CostSpark, colW)
		b.WriteString(shell.Compose(stat1, stat2, stat3))
	}
	return b.String()
}

func (s *Insights) renderStatCard(label, value, delta string, spark []float64, width int) string {
	lbl := shell.SectionTag.Render(label)
	val := lipgloss.NewStyle().Foreground(shell.ColorText).Bold(true).Render(value)
	d := shell.Amber.Render(delta)
	sk := components.Sparkline(spark, width-2, shell.ColorAmber)
	return shell.PadColumnHeight(
		fmt.Sprintf(" %s\n %s  %s\n %s", lbl, val, d, sk),
		width, 4,
	)
}

func (s *Insights) renderTracesTab(ins api.QualityInsightRecord, width int) string {
	if len(ins.LinkedTraceIDs) == 0 {
		return " " + shell.TextMuted.Render("no traces linked")
	}
	var b strings.Builder
	b.WriteString(" " + shell.SectionTag.Render(fmt.Sprintf("LINKED TRACES · %d", len(ins.LinkedTraceIDs))))
	b.WriteString("\n")
	for _, id := range ins.LinkedTraceIDs {
		b.WriteString(" · ")
		b.WriteString(shell.Text.Render(id))
		b.WriteString("\n")
	}
	return b.String()
}

func (s *Insights) renderCasesTab(ins api.QualityInsightRecord, width int) string {
	if len(ins.LinkedCaseIDs) == 0 {
		return " " + shell.TextMuted.Render("no cases linked yet — press [s] to save failures as dataset cases")
	}
	var b strings.Builder
	b.WriteString(" " + shell.SectionTag.Render(fmt.Sprintf("LINKED CASES · %d", len(ins.LinkedCaseIDs))))
	b.WriteString("\n")
	for _, id := range ins.LinkedCaseIDs {
		b.WriteString(" · ")
		b.WriteString(shell.Text.Render(id))
		b.WriteString("\n")
	}
	return b.String()
}

func (s *Insights) renderCompareTab(ins api.QualityInsightRecord, width int) string {
	if len(ins.LinkedExperimentIDs) == 0 {
		return " " + shell.TextMuted.Render("no linked experiments — press [r] to run a variant against this insight")
	}
	var b strings.Builder
	b.WriteString(" " + shell.SectionTag.Render("LINKED EXPERIMENTS"))
	b.WriteString("\n")
	for _, id := range ins.LinkedExperimentIDs {
		b.WriteString(" · ")
		b.WriteString(shell.Text.Render(id))
		b.WriteString("\n")
	}
	return b.String()
}

func (s *Insights) renderFixTab(ins api.QualityInsightRecord, width int) string {
	var b strings.Builder
	b.WriteString(" " + shell.SectionTag.Render("PROPOSED FIX"))
	b.WriteString("\n")
	if ins.ProposedFixConfig != nil && ins.ProposedFixConfig.YAML != "" {
		b.WriteString(boxedPre(ins.ProposedFixConfig.YAML, width-2))
	} else if ins.ProposedFix != "" {
		b.WriteString(boxedPre(ins.ProposedFix, width-2))
	} else {
		b.WriteString(" " + shell.TextMuted.Render("(no fix proposed)"))
	}
	if ins.ProposedFixConfig != nil && len(ins.ProposedFixConfig.ConfigKeys) > 0 {
		b.WriteString("\n\n ")
		b.WriteString(shell.SectionTag.Render("CONFIG KEYS"))
		b.WriteString("\n ")
		b.WriteString(shell.Text.Render(strings.Join(ins.ProposedFixConfig.ConfigKeys, "  ")))
	}
	return b.String()
}

// --- helpers -----------------------------------------------------------------

func (s *Insights) currentInsight() *api.QualityInsightRecord {
	for i, it := range s.items {
		if it.InsightID == s.selectedID {
			return &s.items[i]
		}
	}
	if len(s.items) == 0 {
		return nil
	}
	return &s.items[0]
}

func (s *Insights) moveSelection(delta int) {
	if len(s.items) == 0 {
		return
	}
	idx := 0
	for i, it := range s.items {
		if it.InsightID == s.selectedID {
			idx = i
			break
		}
	}
	idx += delta
	if idx < 0 {
		idx = 0
	}
	if idx >= len(s.items) {
		idx = len(s.items) - 1
	}
	s.selectedID = s.items[idx].InsightID
}

func (s *Insights) cycleTab(delta int) {
	tabs := []string{"diagnosis", "traces", "cases", "compare", "fix"}
	idx := 0
	for i, t := range tabs {
		if t == s.tab {
			idx = i
			break
		}
	}
	idx = (idx + delta + len(tabs)) % len(tabs)
	s.tab = tabs[idx]
}

func wrap(s string, width int) string {
	if width <= 0 {
		return s
	}
	var b strings.Builder
	col := 0
	for _, w := range strings.Fields(s) {
		if col+len(w)+1 > width {
			b.WriteString("\n ")
			col = 0
		}
		if col > 0 {
			b.WriteString(" ")
			col++
		}
		b.WriteString(w)
		col += len(w)
	}
	return b.String()
}

func boxedPre(text string, width int) string {
	style := lipgloss.NewStyle().
		Background(shell.ColorPanel).
		Foreground(shell.ColorText).
		Padding(0, 1).
		Width(width)
	return style.Render(text)
}

func latencyMs(ms float64) string {
	if ms >= 1000 {
		return fmt.Sprintf("%.1fs", ms/1000)
	}
	return fmt.Sprintf("%.0fms", ms)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// --- fetch -------------------------------------------------------------------

type insightsListLoadedMsg []api.QualityInsightRecord

func fetchInsightsList(c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Insights(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightsListLoadedMsg(recs)
	}
}
