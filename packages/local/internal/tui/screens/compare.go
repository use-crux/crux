package screens

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/components"
	"github.com/use-crux/crux/packages/local/internal/tui/overlays"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Compare screen — 2-pane:
//
//	cases list (status pill · base score → cand score)
//	│
//	side-by-side output + trace diff for the selected case
type Compare struct {
	items        []api.QualityComparisonRecord
	selectedID   string
	selectedCase string
	loaded       bool
	err          string

	// onlyDiffs is the "hide unchanged cases" filter toggled by `f`.
	// The right pane uses this when rendering the case list. See S9.
	onlyDiffs bool

	// picker is the reusable suite-picker for `s save-as-case`. Same
	// pattern as Runs S7 — screen-owned, captures keys via EditingScreen.
	picker *overlays.SuitePicker
}

// OnlyDiffs reports whether the only-diffs filter is currently on.
func (s *Compare) OnlyDiffs() bool { return s.onlyDiffs }

// Editing reports whether the suite picker is open (workbench yields
// the keystream per ADR-0050).
func (s *Compare) Editing() bool { return s.picker != nil && s.picker.IsOpen() }

func NewCompare() *Compare { return &Compare{picker: overlays.NewSuitePicker()} }

func (s *Compare) ID() string                { return "compare" }
func (s *Compare) Init(c DataClient) tea.Cmd { return fetchComparisons(c) }
func (s *Compare) Counts() map[string]int    { return nil }

func (s *Compare) Update(msg tea.Msg, c DataClient) tea.Cmd {
	// If the picker is open it owns the keystream — same pattern as
	// Runs S7.
	if km, ok := msg.(tea.KeyMsg); ok && s.picker != nil && s.picker.IsOpen() {
		s.picker.Update(km)
		if !s.picker.IsOpen() {
			if id, confirmed := s.picker.Confirmed(); confirmed {
				return s.submitCaseFromCandidate(c, id)
			}
		}
		return nil
	}
	switch m := msg.(type) {
	case suitesForPickerLoadedMsg:
		if s.picker != nil {
			s.picker.Open([]api.QualitySuiteRecord(m))
		}
		return nil
	case comparisonsLoadedMsg:
		s.items = []api.QualityComparisonRecord(m)
		s.loaded = true
		if s.selectedID == "" && len(s.items) > 0 {
			s.selectedID = s.items[0].ID
			if cur := s.currentComparison(); cur != nil && len(cur.CaseDeltas) > 0 {
				s.selectedCase = cur.CaseDeltas[0].CaseID
			}
		}
	case api.QualityEvent:
		return fetchComparisons(c)
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyMsg:
		switch m.String() {
		case "j", "down":
			s.moveCase(1)
		case "k", "up":
			s.moveCase(-1)
		case "enter":
			return s.drillCandidateRun()
		case "p":
			return s.promoteCandidate(c)
		case "ctrl+n":
			s.cycleComparison(+1)
		case "ctrl+p":
			s.cycleComparison(-1)
		case "f":
			s.onlyDiffs = !s.onlyDiffs
		case "e":
			return s.exportComparison()
		case "s":
			// save-as-case: fetch the suite list, then the
			// suitesForPickerLoadedMsg handler opens the picker; on
			// confirm the candidate's output preview lands as a case.
			return fetchSuitesForPicker(c)
		case "o":
			// External-viewer stub.
			return nil
		}
	}
	return nil
}

// submitCaseFromCandidate builds a Case from the focused comparison's
// candidate side and upserts it into the picked suite. The candidate's
// OutputPreview is used as the expected rubric (full output requires
// a separate run-detail fetch — backend gap, deferred per plan S9).
// The case carries an origin tag so the user knows where it came from.
func (s *Compare) submitCaseFromCandidate(c DataClient, suiteID string) tea.Cmd {
	cur := s.currentComparison()
	if cur == nil {
		return nil
	}
	// Find the focused case delta.
	var delta *api.QualityComparisonCaseDelta
	for i := range cur.CaseDeltas {
		if cur.CaseDeltas[i].CaseID == s.selectedCase {
			delta = &cur.CaseDeltas[i]
			break
		}
	}
	if delta == nil || delta.Candidate == nil {
		return nil
	}
	caseRec := api.QualitySuiteCase{
		CaseID: "case-from-cmp-" + truncate(cur.ID, 8) + "-" + truncate(delta.CaseID, 20),
		Tags:   []string{"from-comparison", delta.Status},
		Expected: map[string]interface{}{
			"rubric":         delta.Candidate.OutputPreview,
			"sourceTraceId":  delta.Candidate.TraceID,
			"sourceCaseId":   delta.CaseID,
			"sourceCompare":  cur.ID,
			"truncatedAsync": "OutputPreview only; full output requires backend fetch (TUI handoff B2)",
		},
		Origin: map[string]interface{}{
			"comparisonId": cur.ID,
			"caseId":       delta.CaseID,
			"side":         "candidate",
		},
	}
	if c == nil {
		return func() tea.Msg { return nil }
	}
	return func() tea.Msg {
		_, err := c.UpsertSuiteCase(context.Background(), suiteID, caseRec)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return caseFromComparisonSavedMsg{suiteID: suiteID, comparisonID: cur.ID, caseID: delta.CaseID}
	}
}

// caseFromComparisonSavedMsg is emitted on a successful save-as-case
// round trip from Compare.
type caseFromComparisonSavedMsg struct {
	suiteID      string
	comparisonID string
	caseID       string
}

// exportComparison writes the focused comparison's case deltas to
// ~/.crux/exports/comparison-{id}.csv. No-op when nothing focused.
func (s *Compare) exportComparison() tea.Cmd {
	cur := s.currentComparison()
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
		path := filepath.Join(dir, "comparison-"+truncate(rec.ID, 16)+".csv")
		var sb strings.Builder
		sb.WriteString("case_id,status,score_delta,baseline_trace,candidate_trace\n")
		for _, d := range rec.CaseDeltas {
			scoreDelta := ""
			if d.ScoreDelta != nil {
				scoreDelta = fmt.Sprintf("%.4f", *d.ScoreDelta)
			}
			baseTrace := ""
			if d.Baseline != nil {
				baseTrace = d.Baseline.TraceID
			}
			candTrace := ""
			if d.Candidate != nil {
				candTrace = d.Candidate.TraceID
			}
			sb.WriteString(fmt.Sprintf("%s,%s,%s,%s,%s\n",
				csvEscape(d.CaseID), d.Status, scoreDelta, baseTrace, candTrace))
		}
		if err := os.WriteFile(path, []byte(sb.String()), 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return comparisonExportedMsg{comparisonID: rec.ID, path: path}
	}
}

// comparisonExportedMsg is emitted on a successful `e` export.
type comparisonExportedMsg struct {
	comparisonID string
	path         string
}

// csvEscape wraps a value in double-quotes when it contains a comma
// or quote (CSV standard); otherwise returns it as-is.
func csvEscape(s string) string {
	if !strings.ContainsAny(s, ",\"\n") {
		return s
	}
	return "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
}

// cycleComparison advances the active comparison through the loaded
// list (bounded — no wraparound, to avoid surprise navigation when
// holding the chord). Reseeds `selectedCase` to the first case of the
// newly-active comparison so the right pane stays coherent.
func (s *Compare) cycleComparison(delta int) {
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
	if s.items[idx].ID == s.selectedID {
		return
	}
	s.selectedID = s.items[idx].ID
	if cur := s.currentComparison(); cur != nil && len(cur.CaseDeltas) > 0 {
		s.selectedCase = cur.CaseDeltas[0].CaseID
	} else {
		s.selectedCase = ""
	}
}

// drillCandidateRun emits a NavigateRequest that stages the candidate
// run id for the focused case and jumps to Runs. The user can use
// further screen-level keys on Runs to explore; later wiring can also
// stash the baseline run id as KindPeerRun so Runs can render a chip.
func (s *Compare) drillCandidateRun() tea.Cmd {
	cur := s.currentComparison()
	if cur == nil {
		return nil
	}
	for _, d := range cur.CaseDeltas {
		if d.CaseID == s.selectedCase && d.Candidate != nil && d.Candidate.TraceID != "" {
			candidateID := d.Candidate.TraceID
			return func() tea.Msg {
				return NavigateRequest{NavID: "runs", Kind: "run", ID: candidateID}
			}
		}
	}
	return nil
}

// promoteCandidate calls c.CreateBaseline with the focused comparison's
// candidate side, pinning the candidate variant as the new baseline
// for the target. Per the W3→W4 workflow this is where promotion
// decisions land.
func (s *Compare) promoteCandidate(c DataClient) tea.Cmd {
	cur := s.currentComparison()
	if cur == nil {
		return nil
	}
	cand := cur.Candidate
	if cand.ExperimentID == "" {
		return nil
	}
	req := api.QualityBaselinePostRequest{
		ID:         "baseline-from-" + cur.ID,
		Experiment: cand.ExperimentID,
		VariantID:  cand.VariantID,
		Label:      cand.Label,
	}
	if c == nil {
		return func() tea.Msg { return nil }
	}
	return func() tea.Msg {
		rec, err := c.CreateBaseline(context.Background(), req)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return candidatePromotedMsg{baselineID: rec.ID, comparisonID: cur.ID}
	}
}

// candidatePromotedMsg is emitted on successful CreateBaseline. The
// screen can drill the user to the Baselines screen with the new
// baseline pre-selected.
type candidatePromotedMsg struct {
	baselineID   string
	comparisonID string
}

func (s *Compare) Breadcrumb() ([]string, string) {
	path := []string{"compare"}
	if cur := s.currentComparison(); cur != nil {
		// Render `{baseline-label} ⇄ {candidate-label}` so the user
		// can read the sides at a glance — falls back to the
		// comparison id if labels are missing. Matches screenshot 5.
		path = append(path, comparisonHeader(cur))
		if s.selectedCase != "" {
			path = append(path, s.selectedCase)
		}
	} else if s.selectedID != "" {
		path = append(path, truncate(s.selectedID, 12))
	}
	right := ""
	if cur := s.currentComparison(); cur != nil && cur.Gates != nil {
		switch cur.Gates.Status {
		case "failed":
			right = shell.Rose.Render("gate: failed · exit 1")
		case "passed":
			right = shell.Green.Render("gate: passed")
		}
	}
	return path, right
}

// comparisonHeader formats the comparison's "baseline ⇄ candidate"
// breadcrumb segment using each side's label if present, else its
// experiment id.
func comparisonHeader(cur *api.QualityComparisonRecord) string {
	left := comparisonSideLabel(cur.Baseline)
	right := comparisonSideLabel(cur.Candidate)
	if left == "" && right == "" {
		return truncate(cur.ID, 12)
	}
	return left + " ⇄ " + right
}

func comparisonSideLabel(side api.QualityComparisonSummary) string {
	if side.Label != nil && *side.Label != "" {
		return *side.Label
	}
	return side.ExperimentID
}

func (s *Compare) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		{"j/k", "case"}, {"↵", "drill run"},
		{"s", "save case"}, {"p", "promote"},
		{"y", "yank"}, {"f", "only diffs"},
		{"e", "export"}, {"o", "open in viewer"},
		{":", "cmd"}, {"?", "help"},
		// Per KEYBINDS.md: `o` is open-in-external (not "only diffs");
		// the only-diffs filter is `f`. `p` is promote (not "copy
		// prompt" — yank-style copies live under the `y` prefix).
		// `r re-run` intentionally absent until backend RerunRun lands.
	}
}

func (s *Compare) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading comparisons…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no comparisons yet — run `compare` against two experiments.")
	}
	listW := size.Width * 36 / 100
	if listW < 50 {
		listW = 50
	}
	detailW := size.Width - listW - 1
	list := s.renderList(listW, size.Height)
	detail := s.renderDetail(detailW, size.Height)
	body := shell.Compose(
		shell.PadColumnHeight(list, listW, size.Height),
		shell.PadColumnHeight(detail, detailW, size.Height),
	)
	if s.picker != nil && s.picker.IsOpen() {
		return body + "\n" + s.picker.View(size.Width, size.Height)
	}
	return body
}

func (s *Compare) renderList(width, height int) string {
	cur := s.currentComparison()
	if cur == nil {
		return ""
	}
	header := shell.PaneHeader(width, "Cases", fmt.Sprintf("%d", len(cur.CaseDeltas)), shell.TextMuted.Render("only diffs"))
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	// summary row
	fix, reg, newF, imp := 0, 0, 0, 0
	for _, d := range cur.CaseDeltas {
		switch d.Status {
		case "fixed":
			fix++
		case "regressed":
			reg++
		case "new", "new-fail":
			newF++
		case "improved":
			imp++
		}
	}
	// Summary glyphs use the same shapes as the per-row glyphs so the
	// header counts read consistently with the rows below. Previously
	// "regressed" used `●` in the summary but `↓` in rows, which made
	// the screen look like two different vocabularies.
	summary := fmt.Sprintf(" %s %d regressed  %s %d new  %s %d fixed  %s %d improved",
		shell.Rose.Render("↓"), reg,
		shell.Violet.Render("◆"), newF,
		shell.Green.Render("✓"), fix,
		shell.Green.Render("↑"), imp,
	)
	b.WriteString(padRow(summary, width))
	b.WriteString("\n")
	bodyRows--

	count := 0
	for _, d := range cur.CaseDeltas {
		if count >= bodyRows {
			break
		}
		b.WriteString(s.renderCaseRow(d, width, d.CaseID == s.selectedCase))
		b.WriteString("\n")
		count++
	}
	for count < bodyRows {
		b.WriteString(strings.Repeat(" ", width) + "\n")
		count++
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Compare) renderCaseRow(d api.QualityComparisonCaseDelta, width int, selected bool) string {
	glyph, color := statusGlyph(d.Status)
	statusG := lipgloss.NewStyle().Foreground(color).Render(glyph)
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(color).Render("▌")
	}

	name := d.CaseName
	if name == "" {
		name = d.CaseID
	}
	name = truncate(name, width-30)

	base, cand := "—", "—"
	if d.Baseline != nil && d.Baseline.Score != nil {
		base = fmt.Sprintf("%.2f", *d.Baseline.Score)
	}
	if d.Candidate != nil && d.Candidate.Score != nil {
		cand = fmt.Sprintf("%.2f", *d.Candidate.Score)
	}
	row := fmt.Sprintf("%s%s %s  %s → %s",
		bar, statusG, shell.Text.Render(name),
		shell.TextDim.Render(base),
		lipgloss.NewStyle().Foreground(color).Render(cand),
	)
	return padRow(row, width)
}

func (s *Compare) renderDetail(width, height int) string {
	cur := s.currentComparison()
	if cur == nil {
		return ""
	}
	delta := s.currentCase()
	if delta == nil {
		return centerMsg(Size{Width: width, Height: height}, "select a case")
	}
	header := shell.PaneHeader(width, delta.CaseName, delta.Status, "")
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	colW := (width - 1) / 2

	baseHeader := " " + shell.SectionTag.Render("← baseline")
	candHeader := " " + shell.SectionTag.Render("→ candidate")
	baseScore := scoreString(delta.Baseline)
	candScore := scoreString(delta.Candidate)
	baseTop := fmt.Sprintf("%s\n %s", baseHeader, baseScore)
	candTop := fmt.Sprintf("%s\n %s", candHeader, candScore)
	b.WriteString(shell.Compose(
		shell.PadColumnHeight(baseTop, colW, 3),
		shell.PadColumnHeight(candTop, colW, 3),
	))
	b.WriteString("\n")
	b.WriteString(horizontalRuleDim(width))
	b.WriteString("\n")

	bodyH := height - strings.Count(b.String(), "\n") - 4
	if bodyH < 6 {
		bodyH = 6
	}

	baseBody := s.renderSide(delta.Baseline, "Output", colW, bodyH/2)
	candBody := s.renderSide(delta.Candidate, "Output", colW, bodyH/2)
	b.WriteString(shell.Compose(
		shell.PadColumnHeight(baseBody, colW, bodyH/2),
		shell.PadColumnHeight(candBody, colW, bodyH/2),
	))
	b.WriteString("\n")

	if delta.OutputChange != "" {
		b.WriteString(horizontalRuleDim(width))
		b.WriteString("\n " + shell.SectionTag.Render("OUTPUT DIFF") + "\n")
		b.WriteString(shell.TextDim.Render(wrap(delta.OutputChange, width-2)))
	}

	footer := shell.PaneFooter(width, []shell.Keybind{
		{"o", "only diffs"}, {"s", "save case"},
		{"p", "copy prompt"}, {"r", "re-run"},
	})
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := shell.PadColumnHeight(b.String(), width, height-hdrH-footerH+1)
	_ = cur
	_ = components.StatusDot // satisfy import in case re-used
	return body + "\n" + footer
}

func (s *Compare) renderSide(side *api.QualityComparisonCaseSide, label string, width, height int) string {
	if side == nil {
		return " " + shell.TextMuted.Render("(missing)")
	}
	var b strings.Builder
	b.WriteString(" " + shell.SectionTag.Render(label))
	b.WriteString("\n")
	out := side.OutputPreview
	if out == "" {
		out = "(no output)"
	}
	b.WriteString(boxedPre(out, width-2))
	return b.String()
}

func (s *Compare) moveCase(delta int) {
	cur := s.currentComparison()
	if cur == nil || len(cur.CaseDeltas) == 0 {
		return
	}
	idx := 0
	for i, c := range cur.CaseDeltas {
		if c.CaseID == s.selectedCase {
			idx = i
			break
		}
	}
	idx += delta
	if idx < 0 {
		idx = 0
	}
	if idx >= len(cur.CaseDeltas) {
		idx = len(cur.CaseDeltas) - 1
	}
	s.selectedCase = cur.CaseDeltas[idx].CaseID
}

func (s *Compare) currentComparison() *api.QualityComparisonRecord {
	for i, c := range s.items {
		if c.ID == s.selectedID {
			return &s.items[i]
		}
	}
	if len(s.items) > 0 {
		return &s.items[0]
	}
	return nil
}

func (s *Compare) currentCase() *api.QualityComparisonCaseDelta {
	cur := s.currentComparison()
	if cur == nil {
		return nil
	}
	for i, c := range cur.CaseDeltas {
		if c.CaseID == s.selectedCase {
			return &cur.CaseDeltas[i]
		}
	}
	if len(cur.CaseDeltas) > 0 {
		return &cur.CaseDeltas[0]
	}
	return nil
}

func statusGlyph(st string) (string, lipgloss.Color) {
	switch st {
	case "regressed":
		return "↓", shell.ColorRose
	case "new", "new-fail":
		return "◆", shell.ColorViolet
	case "fixed":
		return "✓", shell.ColorGreen
	case "improved":
		return "↑", shell.ColorGreen
	case "still_failing":
		return "✗", shell.ColorRose
	default:
		return "·", shell.ColorTextMuted
	}
}

func scoreString(side *api.QualityComparisonCaseSide) string {
	if side == nil {
		return shell.TextMuted.Render("(missing)")
	}
	pass := shell.Green.Render("pass")
	if side.Status == "fail" || side.Status == "failed" {
		pass = shell.Rose.Render("fail")
	}
	score := "—"
	if side.Score != nil {
		score = fmt.Sprintf("%.2f", *side.Score)
	}
	return fmt.Sprintf("%s %s · %sms", pass, score, fmtFloat(side.DurationMs))
}

func fmtFloat(f float64) string {
	if f >= 1000 {
		return fmt.Sprintf("%.1fs", f/1000)
	}
	return fmt.Sprintf("%.0f", f)
}

// --- fetch -------------------------------------------------------------------

type comparisonsLoadedMsg []api.QualityComparisonRecord

func fetchComparisons(c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Comparisons(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return comparisonsLoadedMsg(recs)
	}
}
