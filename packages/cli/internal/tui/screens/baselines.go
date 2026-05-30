package screens

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/anthropics/crux-cli/internal/api"
	"github.com/anthropics/crux-cli/internal/tui/shell"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Baselines — 2-pane: promoted reference list + detail.
type Baselines struct {
	items      []api.QualityBaselineRecord
	selectedID string
	loaded     bool
	err        string
}

func NewBaselines() *Baselines { return &Baselines{} }

func (s *Baselines) ID() string                       { return "baselines" }
func (s *Baselines) Init(c DataClient) tea.Cmd        { return fetchBaselines(c) }
func (s *Baselines) Counts() map[string]int           { return map[string]int{"baselines": len(s.items)} }

func (s *Baselines) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case baselinesLoadedMsg:
		s.items = []api.QualityBaselineRecord(m)
		s.loaded = true
		if s.selectedID == "" && len(s.items) > 0 {
			s.selectedID = s.items[0].ID
		}
	case api.QualityEvent:
		return fetchBaselines(c)
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyMsg:
		switch m.String() {
		case "j", "down":
			s.move(1)
		case "k", "up":
			s.move(-1)
		case "enter":
			return s.drillExperiment()
		case "e":
			return s.exportBaseline()
		case "D":
			return s.demoteStub()
		case "o":
			// External-viewer stub; same pattern as other screens.
			return nil
		}
	}
	return nil
}

// drillExperiment emits a NavigateRequest staging the focused
// baseline's source experiment id. Per plan S11.
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
		path := filepath.Join(dir, "baseline-"+truncate(rec.ID, 32)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return baselineExportedMsg{baselineID: rec.ID, path: path}
	}
}

type baselineExportedMsg struct {
	baselineID string
	path       string
}

// demoteStub returns a non-nil cmd for `D` until the backend
// `DemoteBaseline` service method lands. Surfaces "backend pending"
// to the activity feed (handled by workbench when consumed).
func (s *Baselines) demoteStub() tea.Cmd {
	cur := s.currentBaseline()
	if cur == nil {
		return nil
	}
	id := cur.ID
	return func() tea.Msg {
		return demoteBaselinePendingMsg{baselineID: id}
	}
}

type demoteBaselinePendingMsg struct{ baselineID string }

func (s *Baselines) Breadcrumb() ([]string, string) {
	path := []string{"baselines"}
	if s.selectedID != "" {
		path = append(path, truncate(s.selectedID, 12))
	}
	return path, fmt.Sprintf("%d baselines", len(s.items))
}

func (s *Baselines) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		{"j/k", "move"}, {"↵", "open experiment"},
		{"c", "compare"}, {"e", "export"},
		{"D", "demote"}, {"o", "open in viewer"},
		{":", "cmd"}, {"?", "help"},
		// `R replace` removed — promotion lives on the Compare screen
		// per the W3→W4 workflow. See plan S11.
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
		return centerMsg(size, "no baselines pinned yet — go to Experiments (g x), pick a winner, press p to promote.")
	}
	listW := size.Width * 38 / 100
	detailW := size.Width - listW - 1
	list := s.renderList(listW, size.Height)
	detail := s.renderDetail(detailW, size.Height)
	return shell.Compose(
		shell.PadColumnHeight(list, listW, size.Height),
		shell.PadColumnHeight(detail, detailW, size.Height),
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
		if count >= bodyRows {
			break
		}
		b.WriteString(s.renderRow(it, width, it.ID == s.selectedID))
		b.WriteString("\n")
		count++
	}
	for count < bodyRows {
		b.WriteString(strings.Repeat(" ", width) + "\n")
		count++
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Baselines) renderRow(it api.QualityBaselineRecord, width int, selected bool) string {
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	label := it.ID
	if it.Label != nil {
		label = *it.Label
	}
	pass := fmt.Sprintf("%.0f%%", it.Summary.PassRate*100)
	line1 := fmt.Sprintf("%s%s %s  %s", bar, shell.Teal.Render("◎"),
		shell.Text.Render(truncate(label, width-18)),
		shell.TextDim.Render(pass))
	line2 := "    " + shell.TextMuted.Render(fmt.Sprintf("exp %s · %s",
		truncate(it.ExperimentID, 10),
		relTime(it.PromotedAt)))
	return padRow(line1, width) + "\n" + padRow(line2, width)
}

func (s *Baselines) renderDetail(width, height int) string {
	cur := s.currentBaseline()
	if cur == nil {
		return centerMsg(Size{Width: width, Height: height}, "select a baseline")
	}
	label := cur.ID
	if cur.Label != nil {
		label = *cur.Label
	}
	header := shell.PaneHeader(width, label, fmt.Sprintf("baseline · pinned %s", relTime(cur.PromotedAt)), "")
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	b.WriteString(" " + shell.SectionTag.Render("LINKED"))
	b.WriteString("\n")
	b.WriteString(kvRow("experiment", cur.ExperimentID, width))
	if cur.VariantID != nil {
		b.WriteString(kvRow("variant", *cur.VariantID, width))
	}
	b.WriteString("\n " + shell.SectionTag.Render("SUMMARY"))
	b.WriteString("\n")
	b.WriteString(kvRow("pass", fmt.Sprintf("%.0f%% (%d/%d)",
		cur.Summary.PassRate*100,
		cur.Summary.Passed, cur.Summary.Total), width))
	b.WriteString(kvRow("avg latency", fmt.Sprintf("%.0fms", cur.Summary.AvgDurationMs), width))
	if len(cur.Summary.NumericScores) > 0 {
		b.WriteString("\n " + shell.SectionTag.Render("SCORES"))
		b.WriteString("\n")
		for name, v := range cur.Summary.NumericScores {
			b.WriteString(kvRow(name, fmt.Sprintf("%.3f", v), width))
		}
	}
	footer := shell.PaneFooter(width, []shell.Keybind{
		{"c", "compare latest"}, {"R", "replace"}, {"o", "open experiment"},
	})
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := shell.PadColumnHeight(b.String(), width, height-hdrH-footerH+1)
	return body + "\n" + footer
}

func (s *Baselines) move(delta int) {
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

func (s *Baselines) currentBaseline() *api.QualityBaselineRecord {
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

// --- fetch -------------------------------------------------------------------

type baselinesLoadedMsg []api.QualityBaselineRecord

func fetchBaselines(c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Baselines(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return baselinesLoadedMsg(recs)
	}
}
