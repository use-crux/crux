package screens

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Baselines — 2-pane over the spec-02 promoted BaselineRecords
// (committed `baselines/<evaluationId>.json` files): list + detail with
// the per-case score reference table.
type Baselines struct {
	items      []api.QualityPromotedBaseline
	selectedID string
	loaded     bool
	err        string
}

func NewBaselines() *Baselines { return &Baselines{} }

func (s *Baselines) ID() string                { return "baselines" }
func (s *Baselines) Init(c DataClient) tea.Cmd { return fetchPromotedBaselines(c) }
func (s *Baselines) Counts() map[string]int    { return map[string]int{"baselines": len(s.items)} }
func (s *Baselines) Interested(domains bridge.Domains) bool {
	return domains.Has(bridge.DomainBaselines)
}

func (s *Baselines) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case baselinesLoadedMsg:
		s.items = []api.QualityPromotedBaseline(m)
		s.loaded = true
		if s.currentBaseline() == nil && len(s.items) > 0 {
			s.selectedID = s.items[0].BaselineID
		}
	case api.QualityEvent:
		return fetchPromotedBaselines(c)
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyPressMsg:
		switch m.String() {
		case "j", "down":
			s.move(1)
		case "k", "up":
			s.move(-1)
		case "enter":
			return s.drillExperiment()
		case "e":
			return s.exportBaseline()
		}
	}
	return nil
}

// drillExperiment emits a NavigateRequest staging the focused baseline's
// source experiment id so the Experiments screen opens with it selected.
func (s *Baselines) drillExperiment() tea.Cmd {
	cur := s.currentBaseline()
	if cur == nil || cur.ExperimentID == "" {
		return nil
	}
	expID := cur.ExperimentID
	return func() tea.Msg {
		return NavigateRequest{NavID: "experiments", Kind: "experiment", ID: expID}
	}
}

// exportBaseline writes the focused record to
// ~/.crux/exports/baseline-{id}.json.
func (s *Baselines) exportBaseline() tea.Cmd {
	cur := s.currentBaseline()
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
		path := filepath.Join(dir, "baseline-"+truncate(rec.BaselineID, 32)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return baselineExportedMsg{baselineID: rec.BaselineID, path: path}
	}
}

type baselineExportedMsg struct {
	baselineID string
	path       string
}

func (s *Baselines) Breadcrumb() ([]string, string) {
	path := []string{"baselines"}
	if s.selectedID != "" {
		path = append(path, shortID(s.selectedID, 12))
	}
	return path, fmt.Sprintf("%d baselines", len(s.items))
}

func (s *Baselines) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		shell.Bind("j/k", "move"), shell.Bind("↵", "open experiment"),
		shell.Bind("e", "export"),
		shell.Bind(":", "cmd"), shell.Bind("?", "help"),
	}
}

func (s *Baselines) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading baselines…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no baselines promoted yet — go to Experiments (g x), pick a winner, press p to promote.")
	}
	listW := size.Width * 38 / 100
	detailW := size.Width - listW - 1
	list := s.renderList(listW, size.Height)
	detail := s.renderDetail(detailW, size.Height)
	return kit.ComposeColumns(
		kit.PadBlock(list, listW, size.Height),
		kit.PadBlock(detail, detailW, size.Height),
	)
}

func (s *Baselines) renderList(width, height int) string {
	header := shell.PaneHeader(width, "Baselines", fmt.Sprintf("%d", len(s.items)), "")
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	count := 0
	for _, it := range s.items {
		if count+2 > bodyRows {
			break
		}
		b.WriteString(s.renderRow(it, width, it.BaselineID == s.selectedID))
		b.WriteString("\n")
		count += 2
	}
	for ; count < bodyRows; count++ {
		b.WriteString(strings.Repeat(" ", width) + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Baselines) renderRow(it api.QualityPromotedBaseline, width int, selected bool) string {
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	line1 := fmt.Sprintf("%s%s %s  %s", bar, shell.Teal.Render("◎"),
		shell.Text.Render(truncate(it.EvaluationID, width-18)),
		shell.TextDim.Render(shortID(it.BaselineID, 10)))
	meta := relTime(it.PromotedAt)
	if it.PromotedBy != "" {
		meta += " · " + it.PromotedBy
	}
	line2 := "    " + shell.TextMuted.Render(meta)
	return padRow(line1, width) + "\n" + padRow(line2, width)
}

func (s *Baselines) renderDetail(width, height int) string {
	cur := s.currentBaseline()
	if cur == nil {
		return centerMsg(Size{Width: width, Height: height}, "select a baseline")
	}
	header := shell.PaneHeader(width, cur.EvaluationID,
		fmt.Sprintf("baseline · promoted %s", relTime(cur.PromotedAt)), "")
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	b.WriteString(" " + shell.SectionTag.Render("LINKED"))
	b.WriteString("\n")
	b.WriteString(kvRow("baseline", cur.BaselineID, width))
	b.WriteString(kvRow("experiment", cur.ExperimentID, width))
	if cur.VariantName != "" {
		b.WriteString(kvRow("variant", cur.VariantName, width))
	}
	if cur.PromotedBy != "" {
		b.WriteString(kvRow("promoted by", cur.PromotedBy, width))
	}
	b.WriteString(kvRow("config fp", cur.ConfigFingerprint, width))

	if len(cur.Reference) > 0 {
		b.WriteString("\n " + shell.SectionTag.Render(fmt.Sprintf("REFERENCE (%d cases)", len(cur.Reference))))
		b.WriteString("\n")
		b.WriteString(renderReferenceTable(cur.Reference, width))
	}

	footer := shell.PaneFooter(width, []shell.Keybind{
		shell.Bind("↵", "open experiment"), shell.Bind("e", "export"),
	})
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := kit.PadBlock(b.String(), width, height-hdrH-footerH+1)
	return body + "\n" + footer
}

// renderReferenceTable renders the caseId × score reference matrix the
// comparison engine diffs candidate runs against.
func renderReferenceTable(ref map[string]map[string]float64, width int) string {
	caseIDs := make([]string, 0, len(ref))
	scoreSet := map[string]struct{}{}
	for caseID, scores := range ref {
		caseIDs = append(caseIDs, caseID)
		for name := range scores {
			scoreSet[name] = struct{}{}
		}
	}
	sort.Strings(caseIDs)
	scores := make([]string, 0, len(scoreSet))
	for name := range scoreSet {
		scores = append(scores, name)
	}
	sort.Strings(scores)

	const caseW, scoreW = 30, 12
	var b strings.Builder
	hdr := " " + shell.SectionTag.Render(padString2("CASE", caseW))
	for _, sc := range scores {
		hdr += shell.SectionTag.Render(padString2(strings.ToUpper(truncate(sc, scoreW-1)), scoreW))
	}
	b.WriteString(padRow(hdr, width))
	b.WriteString("\n")
	b.WriteString(horizontalRuleDim(width))
	b.WriteString("\n")
	for _, caseID := range caseIDs {
		row := " " + shell.Text.Render(padString2(truncate(caseID, caseW-1), caseW))
		for _, sc := range scores {
			cell := "—"
			if v, ok := ref[caseID][sc]; ok {
				cell = fmt.Sprintf("%.3f", v)
			}
			row += shell.TextDim.Render(padString2(cell, scoreW))
		}
		b.WriteString(padRow(row, width))
		b.WriteString("\n")
	}
	return b.String()
}

func (s *Baselines) move(delta int) {
	if len(s.items) == 0 {
		return
	}
	idx := 0
	for i, it := range s.items {
		if it.BaselineID == s.selectedID {
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
	s.selectedID = s.items[idx].BaselineID
}

func (s *Baselines) currentBaseline() *api.QualityPromotedBaseline {
	for i, it := range s.items {
		if it.BaselineID == s.selectedID {
			return &s.items[i]
		}
	}
	if len(s.items) > 0 {
		return &s.items[0]
	}
	return nil
}

// --- fetch -------------------------------------------------------------------

type baselinesLoadedMsg []api.QualityPromotedBaseline

func fetchPromotedBaselines(c DataClient) tea.Cmd {
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		recs, err := c.PromotedBaselines(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return baselinesLoadedMsg(recs)
	}
}
