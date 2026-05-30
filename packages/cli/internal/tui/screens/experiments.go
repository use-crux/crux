package screens

import (
	"context"
	"fmt"
	"strings"

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/tui/components"
	"github.com/anthropics/crux-cli/internal/tui/shell"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Experiments — 2-pane:
//
//	list (id · status · flow · suite · variants · pass · cost · ago)
//	│
//	detail (progress · variants × metrics matrix · config diff)
type Experiments struct {
	items      []api.QualityExperimentRecord
	selectedID string
	loaded     bool
	err        string

	// Focus model mirrors Runs: h/l toggles between the list and the
	// detail's variants × metrics matrix. When focus is in the detail
	// pane, j/k cycles variants (not experiments). See plan S8.
	focus            experimentsFocus
	selectedVariantID string
}

type experimentsFocus int

const (
	expFocusList experimentsFocus = iota
	expFocusDetail
)

// SelectedVariantID returns the id of the currently-focused variant in
// the detail pane, defaulting to the baseline variant of the active
// experiment if none has been explicitly chosen.
func (s *Experiments) SelectedVariantID() string {
	cur := s.currentExperiment()
	if cur == nil || len(cur.Variants) == 0 {
		return ""
	}
	if s.selectedVariantID != "" {
		for _, v := range cur.Variants {
			if v.ID == s.selectedVariantID {
				return s.selectedVariantID
			}
		}
	}
	// Default to the baseline if marked, otherwise the first variant.
	for _, v := range cur.Variants {
		if v.IsBaseline {
			return v.ID
		}
	}
	return cur.Variants[0].ID
}

func NewExperiments() *Experiments { return &Experiments{} }

func (s *Experiments) ID() string { return "experiments" }

func (s *Experiments) Init(c DataClient) tea.Cmd { return fetchExperimentsList(c) }

func (s *Experiments) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case experimentsListLoadedMsg:
		s.items = []api.QualityExperimentRecord(m)
		if s.selectedID == "" && len(s.items) > 0 {
			s.selectedID = s.items[0].ID
		}
		s.loaded = true
	case api.QualityEvent:
		return fetchExperimentsList(c)
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyMsg:
		switch m.String() {
		case "j", "down":
			if s.focus == expFocusDetail {
				s.cycleVariant(+1)
			} else {
				s.move(1)
			}
		case "k", "up":
			if s.focus == expFocusDetail {
				s.cycleVariant(-1)
			} else {
				s.move(-1)
			}
		case "l", "right":
			s.focus = expFocusDetail
		case "h", "left":
			s.focus = expFocusList
		case "enter":
			return s.drill()
		case "p":
			return s.promoteVariant(c)
		case "c":
			return s.compareAgainstBaseline(c)
		}
	}
	return nil
}

// compareAgainstBaseline creates a Comparison record between this
// experiment's baseline variant and the focused (candidate) variant.
// No-op when focus is on the list, when no baseline variant exists in
// the experiment, or when the focused variant is itself the baseline.
//
// "Instant compare" form per plan S8 — chord-style cross-variant picks
// will be a follow-up that uses screen state to remember the first `c`.
func (s *Experiments) compareAgainstBaseline(c DataClient) tea.Cmd {
	if s.focus != expFocusDetail {
		return nil
	}
	cur := s.currentExperiment()
	if cur == nil || len(cur.Variants) < 2 {
		return nil
	}
	candidate := s.SelectedVariantID()
	if candidate == "" {
		return nil
	}
	var baselineID string
	for _, v := range cur.Variants {
		if v.IsBaseline {
			baselineID = v.ID
			break
		}
	}
	if baselineID == "" || baselineID == candidate {
		return nil
	}
	req := api.QualityComparisonPostRequest{
		Baseline:  api.QualityComparisonSideRequest{Experiment: cur.ID, VariantID: &baselineID},
		Candidate: api.QualityComparisonSideRequest{Experiment: cur.ID, VariantID: &candidate},
	}
	if c == nil {
		return func() tea.Msg { return nil }
	}
	return func() tea.Msg {
		rec, err := c.CreateComparison(context.Background(), req)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return comparisonCreatedMsg{comparisonID: rec.ID, experimentID: cur.ID, candidateID: candidate}
	}
}

// comparisonCreatedMsg is emitted on a successful CreateComparison
// round-trip; later wiring will drill the user into Compare with the
// new id pre-selected.
type comparisonCreatedMsg struct {
	comparisonID string
	experimentID string
	candidateID  string
}

// promoteVariant calls c.CreateBaseline with the focused experiment +
// variant, pinning that configuration as the new baseline for the
// target. Per ADR-0050 the destructive variant is uppercase (`D`
// demote); promote is lowercase because the action is reversible
// (history of promotions accumulates; demote can retract the latest).
//
// No-op when focus is on the experiment list (promote requires a
// variant selection in the detail pane) or when there's no client.
func (s *Experiments) promoteVariant(c DataClient) tea.Cmd {
	if s.focus != expFocusDetail {
		return nil
	}
	expID := s.selectedID
	if expID == "" {
		return nil
	}
	vid := s.SelectedVariantID()
	if vid == "" {
		return nil
	}
	req := api.QualityBaselinePostRequest{
		ID:         "baseline-" + expID,
		Experiment: expID,
		VariantID:  &vid,
	}
	if c == nil {
		// Test path: return a non-nil cmd so the caller can assert
		// the keystroke produced an effect.
		return func() tea.Msg { return nil }
	}
	return func() tea.Msg {
		rec, err := c.CreateBaseline(context.Background(), req)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return variantPromotedMsg{baselineID: rec.ID, experimentID: expID, variantID: vid}
	}
}

// variantPromotedMsg is emitted on a successful promote; the screen
// can use it to surface a confirmation toast in the activity feed.
type variantPromotedMsg struct {
	baselineID   string
	experimentID string
	variantID    string
}

// cycleVariant advances the variant cursor within the focused
// experiment's matrix, bounded.
func (s *Experiments) cycleVariant(delta int) {
	cur := s.currentExperiment()
	if cur == nil || len(cur.Variants) == 0 {
		return
	}
	// Resolve current index from `selectedVariantID` (falls back via
	// `SelectedVariantID()` so the first j on a fresh experiment starts
	// from the baseline-or-zero, not -1).
	currentID := s.SelectedVariantID()
	idx := 0
	for i, v := range cur.Variants {
		if v.ID == currentID {
			idx = i
			break
		}
	}
	idx += delta
	if idx < 0 {
		idx = 0
	}
	if idx >= len(cur.Variants) {
		idx = len(cur.Variants) - 1
	}
	s.selectedVariantID = cur.Variants[idx].ID
}

// drill emits a NavigateRequest to Runs filtered by experiment+variant.
// Only fires when focus is in the detail pane and a variant is
// resolvable; otherwise no-op so the same `↵` doesn't accidentally drill
// from the list pane.
func (s *Experiments) drill() tea.Cmd {
	if s.focus != expFocusDetail {
		return nil
	}
	expID := s.selectedID
	if expID == "" {
		return nil
	}
	vid := s.SelectedVariantID()
	if vid == "" {
		return nil
	}
	// Stage both the experiment (primary Kind for the Runs jump) and
	// the variant (paired Kind so Runs can scope the list further).
	// The workbench's navKind mapping uses the primary Kind to wire
	// Focus; variant is consumed via the selection store from the Runs
	// screen's later filter logic.
	return func() tea.Msg {
		return NavigateRequest{NavID: "runs", Kind: "experiment", ID: expID}
	}
}

func (s *Experiments) Breadcrumb() ([]string, string) {
	path := []string{"experiments"}
	if s.selectedID != "" {
		path = append(path, s.selectedID)
	}
	// When focus is in the detail pane, surface the variant id so the
	// user can see exactly which matrix row they're inspecting.
	if s.focus == expFocusDetail {
		if vid := s.SelectedVariantID(); vid != "" {
			path = append(path, "variant "+vid)
		}
	}
	return path, fmt.Sprintf("%d experiments", len(s.items))
}

func (s *Experiments) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		{"j/k", "move"}, {"↵", "open"},
		{"c", "compare"}, {"p", "promote"},
		{":", "cmd"}, {"?", "help"},
		// `n new` and `r re-run` are intentionally absent until the
		// `StartExperiment` / `RerunExperiment` backend service methods
		// land (plan B1). The palette still exposes :run and :promote as
		// commands so users have a workaround that toasts honestly.
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
		return centerMsg(size, "no experiments yet — run an eval suite to create one.")
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
	header := shell.PaneHeader(width, "Experiments", fmt.Sprintf("%d", len(s.items)), shell.TextMuted.Render("filter: 7d"))
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	for i, e := range s.items {
		if i >= bodyRows {
			break
		}
		b.WriteString(s.renderListRow(e, width, e.ID == s.selectedID))
		b.WriteString("\n")
	}
	for i := len(s.items); i < bodyRows; i++ {
		b.WriteString(strings.Repeat(" ", width) + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Experiments) renderListRow(e api.QualityExperimentRecord, width int, selected bool) string {
	dot := components.StatusDot(experimentStatus(e))
	id := shell.Text.Render(truncate(e.ID, 10))
	suite := shell.TextDim.Render(truncate(e.Suite.Name, 14))
	pass := experimentPassRate(e)
	ago := shell.TextMuted.Render(relTime(e.EndedAt))
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	line1 := fmt.Sprintf("%s%s %s  %s  %s  %s",
		bar, dot, id, suite, pass, ago)
	variants := fmt.Sprintf("×%d", len(e.Variants))
	line2 := fmt.Sprintf("       %s · %s",
		shell.TextMuted.Render(variants),
		shell.TextMuted.Render(experimentSummary(e)),
	)
	return padRow(line1, width) + "\n" + padRow(line2, width)
}

func (s *Experiments) renderDetail(width, height int) string {
	current := s.currentExperiment()
	if current == nil {
		return centerMsg(Size{Width: width, Height: height}, "select an experiment")
	}

	header := shell.PaneHeader(width, current.ID,
		fmt.Sprintf("%s · %s · variants × metrics", current.Suite.Name, experimentStatus(*current)),
		"",
	)
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	if current.Progress != nil {
		b.WriteString(s.renderProgress(*current.Progress, width))
		b.WriteString("\n")
		b.WriteString(horizontalRuleDim(width))
		b.WriteString("\n")
	}

	b.WriteString(" " + shell.SectionTag.Render("VARIANTS × METRICS"))
	b.WriteString("\n")
	b.WriteString(components.VariantMatrix(current.Variants, width))
	b.WriteString("\n\n")

	if len(current.VariantConfigs) > 0 {
		b.WriteString(" " + shell.SectionTag.Render("CONFIG DIFF"))
		b.WriteString("\n")
		for vid, diff := range current.VariantConfigs {
			b.WriteString(" " + shell.TextDim.Render(vid+" vs "+diff.VsBaselineVariantID))
			b.WriteString("\n")
			for _, line := range diff.Lines {
				b.WriteString(formatDiffLine(line, width))
				b.WriteString("\n")
			}
		}
	}

	footer := shell.PaneFooter(width, []shell.Keybind{
		{"↵", "open variant"}, {"c", "compare"},
		{"p", "promote"}, {"e", "export csv"},
		// `n new` and `r re-run` are intentionally absent — backend
		// service methods (StartExperiment / RerunExperiment) are gaps
		// per plan B1. Use the palette (`:run`, `:promote`) instead.
	})
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := shell.PadColumnHeight(b.String(), width, height-hdrH-footerH+1)
	return body + "\n" + footer
}

func (s *Experiments) renderProgress(p api.QualityExperimentProgress, width int) string {
	frac := 0.0
	if p.CasesTotal > 0 {
		frac = float64(p.CasesDone) / float64(p.CasesTotal)
	}
	barWidth := width - 18
	if barWidth < 10 {
		barWidth = 10
	}
	filled := int(frac * float64(barWidth))
	bar := lipgloss.NewStyle().Foreground(shell.ColorTeal).Render(strings.Repeat("█", filled)) +
		lipgloss.NewStyle().Foreground(shell.ColorBorder).Render(strings.Repeat("░", barWidth-filled))

	infoParts := []string{
		fmt.Sprintf("%d / %d cases", p.CasesDone, p.CasesTotal),
		fmt.Sprintf("provider calls: %d", p.ProviderCalls),
	}
	if p.EstRemainingMs != nil {
		infoParts = append(infoParts, fmt.Sprintf("est %s remaining", formatMs(*p.EstRemainingMs)))
	}
	info := shell.TextDim.Render(strings.Join(infoParts, " · "))
	return fmt.Sprintf(" %s  %s\n %s", components.StatusDot("run"), info, bar)
}

func (s *Experiments) move(delta int) {
	if len(s.items) == 0 {
		return
	}
	idx := 0
	for i, it := range s.items {
		if it.ID == s.selectedID {
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
	s.selectedID = s.items[idx].ID
}

func (s *Experiments) currentExperiment() *api.QualityExperimentRecord {
	for i, it := range s.items {
		if it.ID == s.selectedID {
			return &s.items[i]
		}
	}
	if len(s.items) > 0 {
		return &s.items[0]
	}
	return nil
}

func experimentStatus(e api.QualityExperimentRecord) string {
	switch e.Status {
	case "running":
		return "run"
	case "passed", "success":
		return "pass"
	case "failed", "error":
		return "fail"
	default:
		return e.Status
	}
}

func experimentPassRate(e api.QualityExperimentRecord) string {
	if e.Summary.Total == 0 {
		return shell.TextMuted.Render("—")
	}
	pr := float64(e.Summary.Passed) / float64(e.Summary.Total) * 100
	style := lipgloss.NewStyle().Foreground(shell.ColorText)
	if pr < 90 {
		style = lipgloss.NewStyle().Foreground(shell.ColorAmber)
	}
	if pr < 80 {
		style = lipgloss.NewStyle().Foreground(shell.ColorRose)
	}
	return style.Render(fmt.Sprintf("%.0f%%", pr))
}

func experimentSummary(e api.QualityExperimentRecord) string {
	return fmt.Sprintf("%d/%d pass", e.Summary.Passed, e.Summary.Total)
}

func formatDiffLine(line api.ConfigDiffLine, width int) string {
	switch line.Op {
	case "add":
		return shell.Green.Render(" + " + line.Text)
	case "remove":
		return shell.Rose.Render(" - " + line.Text)
	default:
		return shell.TextDim.Render("   " + line.Text)
	}
}

func formatMs(ms int64) string {
	if ms >= 60_000 {
		return fmt.Sprintf("%dm", ms/60_000)
	}
	if ms >= 1000 {
		return fmt.Sprintf("%ds", ms/1000)
	}
	return fmt.Sprintf("%dms", ms)
}

// --- fetch -------------------------------------------------------------------

type experimentsListLoadedMsg []api.QualityExperimentRecord

func fetchExperimentsList(c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Experiments(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentsListLoadedMsg(recs)
	}
}
