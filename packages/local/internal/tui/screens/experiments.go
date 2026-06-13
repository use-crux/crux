package screens

import (
	"context"
	"fmt"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/components"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Experiments — 2-pane over the spec-02 experiment records:
//
//	list (evaluation · short id · cells · gates · replay · age)
//	│
//	detail (variants × aggregates · gates · comparison deltas · failing cells)
//
// The list binds to ExperimentSummaries; the detail pane lazily fetches the
// full typed record (ExperimentDetail) for the selected row.
type Experiments struct {
	items      []api.QualityExperimentSummary
	selectedID string
	detail     *api.QualityExperimentDetail
	loaded     bool
	err        string
	notice     string

	// Focus model mirrors Runs: h/l toggles between the list and the
	// detail pane. When focus is in the detail pane, j/k cycles the
	// failing-cell cursor (drill target), not experiments.
	focus   experimentsFocus
	cellIdx int
}

type experimentsFocus int

const (
	expFocusList experimentsFocus = iota
	expFocusDetail
)

func NewExperiments() *Experiments { return &Experiments{} }

func (s *Experiments) ID() string { return "experiments" }

func (s *Experiments) Init(c DataClient) tea.Cmd {
	return tea.Batch(fetchExperimentSummaries(c), s.fetchDetail(c))
}

// Focus pre-selects the staged experiment when another screen drills here
// (e.g. Baselines ↵ stages the linked ExperimentID). See ADR-0051.
func (s *Experiments) Focus(kind, id string) {
	if kind == "experiment" && id != "" {
		s.selectedID = id
		s.detail = nil
		s.cellIdx = 0
	}
}

func (s *Experiments) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case experimentsListLoadedMsg:
		s.items = []api.QualityExperimentSummary(m)
		s.loaded = true
		if s.currentSummary() == nil && len(s.items) > 0 {
			s.selectedID = s.items[0].ExperimentID
		}
		if s.detail == nil || (s.currentSummary() != nil && s.detail.ExperimentID != s.selectedID) {
			return s.fetchDetail(c)
		}
	case experimentDetailLoadedMsg:
		if m.experimentID == s.selectedID && m.found {
			d := m.detail
			s.detail = &d
			s.cellIdx = 0
		}
	case experimentPromotedMsg:
		s.notice = fmt.Sprintf("baseline %s promoted → %s", m.result.BaselineID, m.result.Path)
		return fetchExperimentSummaries(c)
	case api.QualityEvent:
		return tea.Batch(fetchExperimentSummaries(c), s.fetchDetail(c))
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyMsg:
		switch m.String() {
		case "j", "down":
			if s.focus == expFocusDetail {
				s.cycleCell(+1)
			} else {
				s.move(1)
				return s.fetchDetail(c)
			}
		case "k", "up":
			if s.focus == expFocusDetail {
				s.cycleCell(-1)
			} else {
				s.move(-1)
				return s.fetchDetail(c)
			}
		case "l", "right":
			s.focus = expFocusDetail
		case "h", "left":
			s.focus = expFocusList
		case "enter":
			return s.drillToRun()
		case "p":
			return s.promote(c)
		}
	}
	return nil
}

// promote calls the injected server-side promote (the embedded worker's
// --promote mode) for the focused experiment. No variant or pin id is
// passed — the worker's own validation explains pin-id requirements and
// filtered-run refusals, and we surface that error verbatim.
func (s *Experiments) promote(c DataClient) tea.Cmd {
	expID := s.selectedID
	if expID == "" {
		return nil
	}
	if c == nil {
		// Test path: non-nil cmd so callers can assert the keystroke
		// produced an effect.
		return func() tea.Msg { return nil }
	}
	return func() tea.Msg {
		res, err := c.PromoteBaseline(context.Background(), expID, "", "")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentPromotedMsg{result: res}
	}
}

// experimentPromotedMsg is emitted on a successful server-side promote.
type experimentPromotedMsg struct {
	result api.QualityPromoteResult
}

// failingCells returns the detail's cells with status != passed/skipped —
// the drillable rows of the detail pane.
func (s *Experiments) failingCells() []api.QualityExperimentCell {
	if s.detail == nil {
		return nil
	}
	out := make([]api.QualityExperimentCell, 0)
	for _, cell := range s.detail.Cases {
		switch cell.Status {
		case "passed", "skipped":
			continue
		}
		out = append(out, cell)
	}
	return out
}

// cycleCell advances the failing-cell cursor, bounded.
func (s *Experiments) cycleCell(delta int) {
	cells := s.failingCells()
	if len(cells) == 0 {
		s.cellIdx = 0
		return
	}
	s.cellIdx += delta
	if s.cellIdx < 0 {
		s.cellIdx = 0
	}
	if s.cellIdx >= len(cells) {
		s.cellIdx = len(cells) - 1
	}
}

// drillToRun emits a NavigateRequest to Runs staging the focused failing
// cell's first traceID. Only fires from the detail pane on a cell that
// actually carries a trace.
func (s *Experiments) drillToRun() tea.Cmd {
	if s.focus != expFocusDetail {
		return nil
	}
	cells := s.failingCells()
	if len(cells) == 0 || s.cellIdx >= len(cells) {
		return nil
	}
	cell := cells[s.cellIdx]
	if len(cell.TraceIDs) == 0 || cell.TraceIDs[0] == "" {
		return nil
	}
	traceID := cell.TraceIDs[0]
	return func() tea.Msg {
		return NavigateRequest{NavID: "runs", Kind: "run", ID: traceID}
	}
}

func (s *Experiments) Breadcrumb() ([]string, string) {
	path := []string{"experiments"}
	if s.selectedID != "" {
		path = append(path, shortID(s.selectedID, 12))
	}
	if s.focus == expFocusDetail {
		if cells := s.failingCells(); len(cells) > 0 && s.cellIdx < len(cells) {
			path = append(path, "cell "+cells[s.cellIdx].CaseID)
		}
	}
	return path, fmt.Sprintf("%d experiments", len(s.items))
}

func (s *Experiments) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		{"j/k", "move"}, {"h/l", "pane"},
		{"↵", "open run"}, {"p", "promote"},
		{":", "cmd"}, {"?", "help"},
	}
}

func (s *Experiments) Counts() map[string]int {
	return map[string]int{"experiments": len(s.items)}
}

func (s *Experiments) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading experiments…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no experiments yet — run `crux quality run` to create one.")
	}

	listW := size.Width * 38 / 100
	if listW < 60 {
		listW = 60
	}
	detailW := size.Width - listW - 1

	list := s.renderList(listW, size.Height)
	detail := s.renderDetail(detailW, size.Height)

	return shell.Compose(
		shell.PadColumnHeight(list, listW, size.Height),
		shell.PadColumnHeight(detail, detailW, size.Height),
	)
}

func (s *Experiments) renderList(width, height int) string {
	header := shell.PaneHeader(width, "Experiments", fmt.Sprintf("%d", len(s.items)), "")
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	rows := 0
	for _, e := range s.items {
		if rows+2 > bodyRows {
			break
		}
		b.WriteString(s.renderListRow(e, width, e.ExperimentID == s.selectedID))
		b.WriteString("\n")
		rows += 2
	}
	for ; rows < bodyRows; rows++ {
		b.WriteString(strings.Repeat(" ", width) + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Experiments) renderListRow(e api.QualityExperimentSummary, width int, selected bool) string {
	status := "fail"
	if e.Passed {
		status = "pass"
	}
	dot := components.StatusDot(status)
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	evalID := shell.Text.Render(truncate(e.EvaluationID, 22))
	id := shell.TextDim.Render(shortID(e.ExperimentID, 10))
	ago := shell.TextMuted.Render(relTime(e.StartedAt))
	line1 := fmt.Sprintf("%s%s %s  %s  %s", bar, dot, evalID, id, ago)

	meta := []string{fmt.Sprintf("%d/%d cells", e.CellsPassed, e.Cells), gatesGlyph(e)}
	if e.ReplayMode != "" {
		meta = append(meta, e.ReplayMode)
	}
	if e.FilteredRun {
		meta = append(meta, shell.Amber.Render("filtered"))
	}
	line2 := "       " + shell.TextMuted.Render(strings.Join(meta, " · "))
	return padRow(line1, width) + "\n" + padRow(line2, width)
}

// gatesGlyph renders the gate verdict marker for a summary row:
// ✓ (passed) / ✗ N (failures), with an `info` tag when the gates ran
// informationally (spec-02 demoted/informational gates don't fail the run).
func gatesGlyph(e api.QualityExperimentSummary) string {
	glyph := shell.Green.Render("gates ✓")
	if !e.GatesPassed {
		glyph = shell.Rose.Render(fmt.Sprintf("gates ✗ %d", e.GateFailures))
	}
	if e.GatesInformational {
		glyph += shell.TextMuted.Render(" (info)")
	}
	return glyph
}

func (s *Experiments) renderDetail(width, height int) string {
	cur := s.currentSummary()
	if cur == nil {
		return centerMsg(Size{Width: width, Height: height}, "select an experiment")
	}
	if s.detail == nil || s.detail.ExperimentID != cur.ExperimentID {
		return centerMsg(Size{Width: width, Height: height}, "loading experiment record…")
	}
	d := s.detail

	subtitle := d.EvaluationID
	if d.ExperimentLabel != "" {
		subtitle += " · " + d.ExperimentLabel
	}
	subtitle += " · replay " + d.Replay.Mode
	if d.Replay.Cassette != "" {
		subtitle += " (" + baseName(d.Replay.Cassette) + ")"
	}
	header := shell.PaneHeader(width, shortID(d.ExperimentID, 24), subtitle, "")

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	if s.notice != "" {
		b.WriteString(" " + shell.Green.Render(s.notice))
		b.WriteString("\n")
	}

	b.WriteString(" " + shell.SectionTag.Render("VARIANTS × AGGREGATES"))
	b.WriteString("\n")
	b.WriteString(renderAggregatesMatrix(d, width))
	b.WriteString("\n")

	b.WriteString(" " + shell.SectionTag.Render("GATES"))
	b.WriteString("\n")
	b.WriteString(renderGates(d.Gates, width))
	b.WriteString("\n")

	if d.Comparison != nil {
		b.WriteString(" " + shell.SectionTag.Render("COMPARISON vs "+truncate(d.Comparison.Baseline, 24)))
		b.WriteString("\n")
		b.WriteString(renderComparison(d.Comparison, width))
		b.WriteString("\n")
	}

	cells := s.failingCells()
	if len(cells) > 0 {
		b.WriteString(" " + shell.SectionTag.Render(fmt.Sprintf("FAILING CELLS (%d)", len(cells))))
		b.WriteString("\n")
		b.WriteString(s.renderFailingCells(cells, width))
	}

	footer := shell.PaneFooter(width, []shell.Keybind{
		{"j/k", "cell"}, {"↵", "open run"}, {"p", "promote"},
	})
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := shell.PadColumnHeight(b.String(), width, height-hdrH-footerH+1)
	return body + "\n" + footer
}

// renderAggregatesMatrix renders one row per variant with pass rate,
// latency, cost, and one column per scorer (mean ±SEM).
func renderAggregatesMatrix(d *api.QualityExperimentDetail, width int) string {
	// Stable variant order: declaration order from the record.
	names := make([]string, 0, len(d.Variants))
	for _, v := range d.Variants {
		names = append(names, v.Name)
	}
	// Any aggregate-only variants (defensive) go last, sorted.
	extra := make([]string, 0)
	for name := range d.Aggregates.PerVariant {
		found := false
		for _, n := range names {
			if n == name {
				found = true
				break
			}
		}
		if !found {
			extra = append(extra, name)
		}
	}
	sort.Strings(extra)
	names = append(names, extra...)

	// Union of scorer names across variants, sorted.
	scorerSet := map[string]struct{}{}
	for _, agg := range d.Aggregates.PerVariant {
		for name := range agg.Scores {
			scorerSet[name] = struct{}{}
		}
	}
	scorers := make([]string, 0, len(scorerSet))
	for name := range scorerSet {
		scorers = append(scorers, name)
	}
	sort.Strings(scorers)

	const nameW, passW, latW, costW, scoreW = 20, 6, 9, 9, 13

	var b strings.Builder
	hdr := " " + shell.SectionTag.Render(padString2("VARIANT", nameW)) +
		shell.SectionTag.Render(padString2("PASS", passW)) +
		shell.SectionTag.Render(padString2("LAT", latW)) +
		shell.SectionTag.Render(padString2("COST", costW))
	for _, sc := range scorers {
		hdr += shell.SectionTag.Render(padString2(strings.ToUpper(truncate(sc, scoreW-1)), scoreW))
	}
	b.WriteString(padRow(hdr, width))
	b.WriteString("\n")
	b.WriteString(horizontalRuleDim(width))
	b.WriteString("\n")

	for _, name := range names {
		agg, ok := d.Aggregates.PerVariant[name]
		if !ok {
			continue
		}
		passStyle := shell.Green
		if agg.PassRate < 1 {
			passStyle = shell.Amber
		}
		if agg.PassRate < 0.8 {
			passStyle = shell.Rose
		}
		cost := "—"
		if agg.CostUsd != nil {
			cost = fmt.Sprintf("$%.3f", *agg.CostUsd)
		}
		row := " " + shell.Text.Render(padString2(truncate(name, nameW-1), nameW)) +
			passStyle.Render(padString2(fmt.Sprintf("%.0f%%", agg.PassRate*100), passW)) +
			shell.TextDim.Render(padString2(fmt.Sprintf("%.0fms", agg.Latency.MeanMs), latW)) +
			shell.TextDim.Render(padString2(cost, costW))
		for _, sc := range scorers {
			cell := "—"
			if stats, ok := agg.Scores[sc]; ok && stats.N > 0 {
				cell = fmt.Sprintf("%.2f ±%.2f", stats.Mean, stats.SEM)
			}
			row += shell.TextDim.Render(padString2(cell, scoreW))
		}
		b.WriteString(padRow(row, width))
		b.WriteString("\n")
	}
	return b.String()
}

func renderGates(g api.QualityExperimentGates, width int) string {
	if len(g.Results) == 0 {
		return padRow(" "+shell.TextMuted.Render("(no gates declared)"), width) + "\n"
	}
	var b strings.Builder
	for _, r := range g.Results {
		mark := shell.Green.Render("✓")
		if !r.Passed {
			mark = shell.Rose.Render("✗")
		}
		label := r.Gate
		if r.VariantName != "" {
			label += " (" + r.VariantName + ")"
		}
		row := fmt.Sprintf(" %s %s  %s", mark,
			shell.Text.Render(truncate(label, width/2)),
			shell.TextDim.Render(fmt.Sprintf("threshold %v · actual %v", r.Threshold, r.Actual)))
		if r.Informational {
			row += " " + shell.TextMuted.Render("(informational)")
		}
		b.WriteString(padRow(row, width))
		b.WriteString("\n")
	}
	return b.String()
}

func renderComparison(c *api.QualityExperimentComparison, width int) string {
	var b strings.Builder
	if c.Demoted != nil {
		b.WriteString(padRow(" "+shell.Amber.Render("demoted: ")+shell.TextDim.Render(c.Demoted.Reason), width))
		b.WriteString("\n")
	}
	if len(c.Deltas) == 0 {
		b.WriteString(padRow(" "+shell.TextMuted.Render("(no score deltas)"), width))
		b.WriteString("\n")
		return b.String()
	}
	for _, delta := range c.Deltas {
		style := shell.TextMuted
		sign := ""
		if delta.MeanDelta > 0 {
			style, sign = shell.Green, "+"
		} else if delta.MeanDelta < 0 {
			style = shell.Rose
		}
		row := fmt.Sprintf(" %s · %s  %s %s",
			shell.Text.Render(truncate(delta.VariantName, 18)),
			shell.TextDim.Render(truncate(delta.ScoreName, 18)),
			style.Render(fmt.Sprintf("Δ%s%.3f ±%.3f", sign, delta.MeanDelta, delta.SEM)),
			shell.TextMuted.Render(fmt.Sprintf("n=%d", delta.N)))
		b.WriteString(padRow(row, width))
		b.WriteString("\n")
	}
	if len(c.UnmatchedCases.BaselineOnly)+len(c.UnmatchedCases.CandidateOnly) > 0 {
		b.WriteString(padRow(" "+shell.TextMuted.Render(fmt.Sprintf(
			"unmatched: %d baseline-only · %d candidate-only",
			len(c.UnmatchedCases.BaselineOnly), len(c.UnmatchedCases.CandidateOnly))), width))
		b.WriteString("\n")
	}
	return b.String()
}

func (s *Experiments) renderFailingCells(cells []api.QualityExperimentCell, width int) string {
	var b strings.Builder
	for i, cell := range cells {
		bar := " "
		if s.focus == expFocusDetail && i == s.cellIdx {
			bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
		}
		trace := ""
		if len(cell.TraceIDs) > 0 {
			trace = shortID(cell.TraceIDs[0], 10)
		}
		line1 := fmt.Sprintf("%s%s %s  %s  %s  %s", bar,
			components.StatusDot(cell.Status),
			shell.Text.Render(truncate(cell.CaseID, 28)),
			shell.TextDim.Render(truncate(cell.VariantName, 16)),
			shell.Rose.Render(cell.Status),
			shell.TextMuted.Render(trace))
		b.WriteString(padRow(line1, width))
		b.WriteString("\n")

		reason := ""
		if len(cell.Assertions.Failures) > 0 {
			f := cell.Assertions.Failures[0]
			reason = f.Message
			if f.SourceRef != "" {
				reason += "  · " + f.SourceRef
			}
		} else if cell.Error != nil {
			reason = cell.Error.Message
			if cell.Error.MissingCassetteKey != "" {
				reason += "  · missing cassette key " + cell.Error.MissingCassetteKey
			}
		}
		if reason != "" {
			b.WriteString(padRow("     "+shell.TextDim.Render(truncate(reason, width-6)), width))
			b.WriteString("\n")
		}
	}
	return b.String()
}

func (s *Experiments) move(delta int) {
	if len(s.items) == 0 {
		return
	}
	idx := 0
	for i, it := range s.items {
		if it.ExperimentID == s.selectedID {
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
	if s.items[idx].ExperimentID != s.selectedID {
		s.selectedID = s.items[idx].ExperimentID
		s.detail = nil
		s.cellIdx = 0
		s.notice = ""
	}
}

func (s *Experiments) currentSummary() *api.QualityExperimentSummary {
	for i, it := range s.items {
		if it.ExperimentID == s.selectedID {
			return &s.items[i]
		}
	}
	return nil
}

// --- fetch -------------------------------------------------------------------

type experimentsListLoadedMsg []api.QualityExperimentSummary

type experimentDetailLoadedMsg struct {
	experimentID string
	detail       api.QualityExperimentDetail
	found        bool
}

func fetchExperimentSummaries(c DataClient) tea.Cmd {
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		recs, err := c.ExperimentSummaries(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentsListLoadedMsg(recs)
	}
}

func (s *Experiments) fetchDetail(c DataClient) tea.Cmd {
	expID := s.selectedID
	if c == nil || expID == "" {
		return nil
	}
	return func() tea.Msg {
		detail, found, err := c.ExperimentDetail(context.Background(), expID)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentDetailLoadedMsg{experimentID: expID, detail: detail, found: found}
	}
}
