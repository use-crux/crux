package screens

import (
	"context"
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Cassettes — 2-pane:
//
//	list (path · drift glyph · entries · mode · age)
//	│
//	detail (stat strip · entries table · drift detail)
type Cassettes struct {
	items        []api.QualityCassetteRecord
	selectedPath string
	loaded       bool
	err          string
}

func NewCassettes() *Cassettes { return &Cassettes{} }

func (s *Cassettes) ID() string                { return "cassettes" }
func (s *Cassettes) Init(c DataClient) tea.Cmd { return fetchCassettes(c) }
func (s *Cassettes) Counts() map[string]int    { return map[string]int{"cassettes": len(s.items)} }

func (s *Cassettes) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case cassettesLoadedMsg:
		s.items = []api.QualityCassetteRecord(m)
		s.loaded = true
		if s.selectedPath == "" && len(s.items) > 0 {
			s.selectedPath = s.items[0].Path
		}
	case api.QualityEvent:
		return fetchCassettes(c)
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyMsg:
		switch m.String() {
		case "j", "down":
			s.move(1)
		case "k", "up":
			s.move(-1)
		case "p":
			// Cassettes exception: `p` = play once (not promote).
			return s.playStub()
		case "R":
			// Cassettes exception: `R` = re-record (destructive, uppercase).
			return s.reRecordStub()
		case "x":
			// `x` = prune missing entries (dismiss-shaped per Layer 2).
			return s.pruneStub()
		case "d":
			// Layer-3 screen-local: diff vs main.
			return s.diffStub()
		case "o":
			// External-viewer stub.
			return nil
		}
	}
	return nil
}

// playStub returns a non-nil cmd until c.PlayCassetteOnce lands.
func (s *Cassettes) playStub() tea.Cmd {
	cur := s.currentCassette()
	if cur == nil {
		return nil
	}
	path := cur.Path
	return func() tea.Msg { return cassettePlayPendingMsg{path: path} }
}

// reRecordStub returns a non-nil cmd until c.ReRecordCassette lands.
func (s *Cassettes) reRecordStub() tea.Cmd {
	cur := s.currentCassette()
	if cur == nil {
		return nil
	}
	path := cur.Path
	return func() tea.Msg { return cassetteReRecordPendingMsg{path: path} }
}

// pruneStub returns a non-nil cmd until c.PruneMissingCassetteEntries lands.
func (s *Cassettes) pruneStub() tea.Cmd {
	cur := s.currentCassette()
	if cur == nil {
		return nil
	}
	path := cur.Path
	return func() tea.Msg { return cassettePrunePendingMsg{path: path} }
}

// diffStub returns a non-nil cmd until c.DiffCassetteVsMain lands.
func (s *Cassettes) diffStub() tea.Cmd {
	cur := s.currentCassette()
	if cur == nil {
		return nil
	}
	path := cur.Path
	return func() tea.Msg { return cassetteDiffPendingMsg{path: path} }
}

type (
	cassettePlayPendingMsg     struct{ path string }
	cassetteReRecordPendingMsg struct{ path string }
	cassettePrunePendingMsg    struct{ path string }
	cassetteDiffPendingMsg     struct{ path string }
)

func (s *Cassettes) Breadcrumb() ([]string, string) {
	path := []string{"cassettes"}
	if s.selectedPath != "" {
		path = append(path, baseName(s.selectedPath))
	}
	return path, fmt.Sprintf("%d cassettes", len(s.items))
}

func (s *Cassettes) Keybinds() []shell.Keybind {
	// Three Cassettes exceptions to the polymorphic-verb contract:
	// `p` = play once (not promote), `R` = re-record (destructive,
	// not run), `e` = edit entry (not export). See KEYBINDS.md.
	return []shell.Keybind{
		{"j/k", "move"}, {"↵", "open"},
		{"p", "play"}, {"R", "re-record"}, {"e", "edit"},
		{"x", "prune"}, {"d", "diff vs main"},
		{"o", "open in viewer"},
		{":", "cmd"}, {"?", "help"},
	}
}

func (s *Cassettes) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading cassettes…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no cassettes recorded yet.")
	}
	listW := size.Width * 36 / 100
	if listW < 40 {
		listW = 40
	}
	detailW := size.Width - listW - 1
	list := s.renderList(listW, size.Height)
	detail := s.renderDetail(detailW, size.Height)
	return shell.Compose(
		shell.PadColumnHeight(list, listW, size.Height),
		shell.PadColumnHeight(detail, detailW, size.Height),
	)
}

func (s *Cassettes) renderList(width, height int) string {
	issues := 0
	for _, c := range s.items {
		if c.MissingCount > 0 || c.MismatchCount > 0 {
			issues++
		}
	}
	right := shell.TextMuted.Render("no issues")
	if issues > 0 {
		right = shell.Amber.Render(fmt.Sprintf("%d issues", issues))
	}
	header := shell.PaneHeader(width, "Cassettes", fmt.Sprintf("%d", len(s.items)), right)
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	count := 0
	for _, c := range s.items {
		if count >= bodyRows {
			break
		}
		b.WriteString(s.renderListRow(c, width, c.Path == s.selectedPath))
		b.WriteString("\n")
		count++
	}
	for count < bodyRows {
		b.WriteString(strings.Repeat(" ", width) + "\n")
		count++
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Cassettes) renderListRow(c api.QualityCassetteRecord, width int, selected bool) string {
	stateGlyph := shell.Green.Render("●")
	if c.MissingCount > 0 || c.MismatchCount > 0 {
		stateGlyph = shell.Amber.Render("◐")
	}
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	name := shell.Text.Render(truncate(baseName(c.Path), width-22))
	age := shell.TextMuted.Render(relTime(c.RecordedAt))
	line1 := fmt.Sprintf("%s%s %s  %s", bar, stateGlyph, name, age)
	modeStyle := shell.Teal
	if c.Mode == "record" {
		modeStyle = shell.Amber
	}
	line2 := fmt.Sprintf("    %s entries · %s",
		shell.TextMuted.Render(fmt.Sprintf("%d", c.EntryCount)),
		modeStyle.Render(c.Mode),
	)
	return padRow(line1, width) + "\n" + padRow(line2, width)
}

func (s *Cassettes) renderDetail(width, height int) string {
	cur := s.currentCassette()
	if cur == nil {
		return ""
	}

	subtitle := fmt.Sprintf("%d entries · %s · %s",
		cur.EntryCount,
		formatBytes(cur.EntryCount), // rough — backend doesn't expose size
		cur.Mode,
	)
	if cur.MissingCount > 0 || cur.MismatchCount > 0 {
		subtitle += " · " + shell.Amber.Render("drift detected")
	}
	header := shell.PaneHeader(width, baseName(cur.Path), subtitle, "")
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	// 4-stat strip (Entries, Hit rate, Missing, Mismatch).
	colW := (width - 4) / 4
	stat := func(label, val, sub string, valColor lipgloss.Color) string {
		lbl := shell.SectionTag.Render(label)
		v := lipgloss.NewStyle().Foreground(valColor).Bold(true).Render(val)
		subline := shell.TextMuted.Render(sub)
		return shell.PadColumnHeight(fmt.Sprintf(" %s\n %s\n %s", lbl, v, subline), colW, 3)
	}
	b.WriteString(shell.Compose(
		stat("ENTRIES", fmt.Sprintf("%d", cur.EntryCount), "", shell.ColorText),
		stat("HIT RATE", fmt.Sprintf("%.0f%%", cur.Coverage*100),
			fmt.Sprintf("last 1h · %d plays", cur.ProviderCallsAvoided), shell.ColorTeal),
		stat("MISSING", fmt.Sprintf("%d", cur.MissingCount),
			missingSubtext(cur, "missing"), missingColor(cur.MissingCount)),
		stat("MISMATCH", fmt.Sprintf("%d", cur.MismatchCount),
			missingSubtext(cur, "mismatch"), missingColor(cur.MismatchCount)),
	))
	b.WriteString("\n")

	// View-tabs row + filter.
	tab := func(label string, selected bool) string {
		if selected {
			return lipgloss.NewStyle().
				Foreground(shell.ColorTeal).
				Underline(true).
				Render(label)
		}
		return shell.TextDim.Render(label)
	}
	tabsRow := " " + shell.TextMuted.Render("view: ") +
		tab("entries", true) + "  " +
		tab("drift", false) + "  " +
		tab("history", false)
	filterRow := shell.TextMuted.Render("filter: state ≠ ok") + " "
	pad := width - lipgloss.Width(tabsRow) - lipgloss.Width(filterRow)
	if pad < 1 {
		pad = 1
	}
	b.WriteString(tabsRow + strings.Repeat(" ", pad) + filterRow)
	b.WriteString("\n")
	b.WriteString(horizontalRuleDim(width))
	b.WriteString("\n")

	// Entries table.
	b.WriteString(s.renderEntriesTable(cur, width))
	b.WriteString("\n")

	// Drift detail block (shown when there's at least one mismatch/missing).
	if cur.MissingCount > 0 || cur.MismatchCount > 0 {
		b.WriteString(s.renderDriftDetail(cur, width))
	}

	footer := shell.PaneFooter(width, []shell.Keybind{
		{"R", "re-record selected"}, {"p", "play once"},
		{"x", "prune missing"}, {"e", "edit entry"}, {"d", "diff vs main"},
	})
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := shell.PadColumnHeight(b.String(), width, height-hdrH-footerH+1)
	return body + "\n" + footer
}

func (s *Cassettes) renderEntriesTable(cur *api.QualityCassetteRecord, width int) string {
	var b strings.Builder

	// Column header (uppercase muted).
	hdr := fmt.Sprintf(" %s  %s  %s  %s  %s",
		shell.SectionTag.Render(padString2("#", 4)),
		shell.SectionTag.Render(padString2("OP", 22)),
		shell.SectionTag.Render(padString2("SIGNATURE", 22)),
		shell.SectionTag.Render(padString2("STATE", 10)),
		shell.SectionTag.Render(padString2("HITS", 4)),
	)
	b.WriteString(padRow(hdr, width))
	b.WriteString("\n")

	rows := cur.Entries
	if len(rows) > 8 {
		rows = rows[:8]
	}
	for i, e := range rows {
		stateColor := shell.ColorGreen
		switch e.Status {
		case "missing":
			stateColor = shell.ColorAmber
		case "mismatch":
			stateColor = shell.ColorRose
		}
		op := e.Kind
		if op == "" {
			op = e.TargetID
		}
		sig := truncate(e.ID, 22)
		row := fmt.Sprintf(" %s  %s  %s  %s  %s",
			shell.TextMuted.Render(padString2(fmt.Sprintf("%03d", i), 4)),
			lipgloss.NewStyle().Foreground(opColorForCassette(op)).Render(padString2(truncate(op, 22), 22)),
			shell.TextDim.Render(padString2(sig, 22)),
			lipgloss.NewStyle().Foreground(stateColor).Render(padString2(e.Status, 10)),
			shell.Text.Render(padString2("0", 4)),
		)
		b.WriteString(padRow(row, width))
		b.WriteString("\n")
	}
	return b.String()
}

func (s *Cassettes) renderDriftDetail(cur *api.QualityCassetteRecord, width int) string {
	var b strings.Builder
	b.WriteString(horizontalRuleDim(width))
	b.WriteString("\n")
	b.WriteString(" " + shell.SectionTag.Render("DRIFT DETAIL · ENTRY #2"))
	b.WriteString("\n")

	// Find the first drifting entry (mismatch first, else missing).
	var entry *api.QualityCassetteEntrySummary
	for i, e := range cur.Entries {
		if e.Status == "mismatch" || e.Status == "missing" {
			entry = &cur.Entries[i]
			break
		}
	}
	if entry == nil {
		b.WriteString(" " + shell.TextMuted.Render("(no drifting entry)"))
		return b.String()
	}

	request := fmt.Sprintf("request:  %s", entry.Kind)
	if entry.TargetID != "" {
		request += "(" + entry.TargetID + ")"
	}
	expectedSig := "sha256:" + truncate(entry.ID, 8) + "…(prompt v?, retriever k=?)"
	currentSig := "sha256:" + truncate(entry.ID, 8) + "…(prompt v?, retriever k=?)"
	reason := entry.Reason
	if reason == "" {
		reason = "(no reason provided)"
	}

	b.WriteString(" " + shell.TextMuted.Render(request))
	b.WriteString("\n")
	b.WriteString(" " + shell.Rose.Render("-  expected signature: "+expectedSig))
	b.WriteString("\n")
	b.WriteString(" " + shell.Green.Render("+  current  signature: "+currentSig))
	b.WriteString("\n")
	b.WriteString(" " + shell.TextMuted.Render("reason:    "+reason))
	b.WriteString("\n")
	return b.String()
}

func missingSubtext(cur *api.QualityCassetteRecord, kind string) string {
	if cur == nil {
		return ""
	}
	for _, e := range cur.Entries {
		if e.Status == kind && e.Kind != "" {
			return e.Kind + " variants"
		}
	}
	return ""
}

func opColorForCassette(op string) lipgloss.Color {
	switch {
	case strings.HasPrefix(op, "openai"), strings.HasPrefix(op, "anthropic"), strings.HasPrefix(op, "llm"):
		return shell.ColorViolet
	case strings.HasPrefix(op, "rag"), strings.HasPrefix(op, "tool"):
		return shell.ColorAmber
	default:
		return shell.ColorTeal
	}
}

func formatBytes(_ int) string {
	// Cassette size isn't exposed by the BFF; the design shows "0.8 MB"
	// for visual completeness. Until the backend adds size, we render a
	// dim placeholder so the row width matches the design.
	return "—"
}

func (s *Cassettes) move(delta int) {
	if len(s.items) == 0 {
		return
	}
	idx := 0
	for i, it := range s.items {
		if it.Path == s.selectedPath {
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
	s.selectedPath = s.items[idx].Path
}

func (s *Cassettes) currentCassette() *api.QualityCassetteRecord {
	for i, it := range s.items {
		if it.Path == s.selectedPath {
			return &s.items[i]
		}
	}
	if len(s.items) > 0 {
		return &s.items[0]
	}
	return nil
}

func missingColor(n int) lipgloss.Color {
	if n == 0 {
		return shell.ColorText
	}
	return shell.ColorAmber
}

func baseName(p string) string {
	if idx := strings.LastIndex(p, "/"); idx >= 0 {
		return p[idx+1:]
	}
	return p
}

// --- fetch -------------------------------------------------------------------

type cassettesLoadedMsg []api.QualityCassetteRecord

func fetchCassettes(c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Cassettes(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return cassettesLoadedMsg(recs)
	}
}
