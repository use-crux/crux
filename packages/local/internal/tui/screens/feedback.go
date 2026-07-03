package screens

import (
	"context"
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Feedback — 2-pane review inbox.
type Feedback struct {
	items      []api.QualityFeedbackRecord
	selectedID string
	loaded     bool
	err        string

	// statusFilter cycles through `open → resolved → dismissed → all`
	// via the `f` chord. The list pane filters render-side using this.
	statusFilter string
}

// StatusFilter returns the current status filter; defaults to "open".
func (s *Feedback) StatusFilter() string {
	if s.statusFilter == "" {
		return "open"
	}
	return s.statusFilter
}

func NewFeedback() *Feedback { return &Feedback{} }

func (s *Feedback) ID() string                { return "feedback" }
func (s *Feedback) Init(c DataClient) tea.Cmd { return fetchFeedback(c) }
func (s *Feedback) Counts() map[string]int    { return map[string]int{"feedback": len(s.items)} }
func (s *Feedback) Interested(domains bridge.Domains) bool {
	return domains.Has(bridge.DomainFeedback)
}

func (s *Feedback) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case feedbackLoadedMsg:
		s.items = []api.QualityFeedbackRecord(m)
		s.loaded = true
		if s.selectedID == "" && len(s.items) > 0 {
			s.selectedID = s.items[0].ID
		}
	case api.QualityEvent:
		return fetchFeedback(c)
	case dataErrMsg:
		s.err = string(m)
	case feedbackAnnotatedMsg:
		s.applyAnnotation(api.QualityFeedbackAnnotationRecord(m))
	case tea.KeyPressMsg:
		switch m.String() {
		case "j", "down":
			s.move(1)
		case "k", "up":
			s.move(-1)
		case "enter":
			return s.drillToSourceRun()
		case "x":
			return s.dismissFeedback(c)
		case "f":
			s.cycleStatusFilter()
		}
	}
	return nil
}

func (s *Feedback) Breadcrumb() ([]string, string) {
	path := []string{"feedback"}
	if s.selectedID != "" {
		path = append(path, truncate(s.selectedID, 12))
	}
	return path, fmt.Sprintf("%d feedback", len(s.items))
}

func (s *Feedback) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		shell.Bind("j/k", "move"), shell.Bind("↵", "open run"),
		shell.Bind("f", "filter"), shell.Bind("x", "dismiss"),
		shell.Bind(":", "cmd"), shell.Bind("?", "help"),
	}
}

func (s *Feedback) View(size Size) string {
	if !s.loaded {
		return centerMsg(size, "loading feedback…")
	}
	if s.err != "" {
		return centerMsg(size, "error: "+s.err)
	}
	if len(s.items) == 0 {
		return centerMsg(size, "no feedback yet — collect 👍/👎 ratings from app users.")
	}
	listW := size.Width * 42 / 100
	detailW := size.Width - listW - 1
	list := s.renderList(listW, size.Height)
	detail := s.renderDetail(detailW, size.Height)
	body := kit.ComposeColumns(
		kit.PadBlock(list, listW, size.Height),
		kit.PadBlock(detail, detailW, size.Height),
	)
	return body
}

func (s *Feedback) renderList(width, height int) string {
	pending := 0
	for _, it := range s.items {
		if it.Status == "open" || it.Status == "" {
			pending++
		}
	}
	header := shell.PaneHeader(width, "Feedback", fmt.Sprintf("%d total", len(s.items)),
		shell.Amber.Render(fmt.Sprintf("%d open", pending)))
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

func (s *Feedback) renderRow(it api.QualityFeedbackRecord, width int, selected bool) string {
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	rating := shell.TextMuted.Render("·")
	if it.Rating != nil {
		if *it.Rating > 0 {
			rating = shell.Green.Render("👍")
		} else if *it.Rating < 0 {
			rating = shell.Rose.Render("👎")
		}
	}
	comment := ""
	if it.Comment != nil {
		comment = *it.Comment
	}
	id := shell.TextMuted.Render(truncate(it.ID, 8))
	status := shell.TextDim.Render(it.Status)
	ago := shell.TextMuted.Render(relTime(it.CreatedAt))
	line1 := fmt.Sprintf("%s%s %s  %s  %s", bar, rating, id, status, ago)
	line2 := "      " + shell.TextDim.Render(truncate(comment, width-8))
	return padRow(line1, width) + "\n" + padRow(line2, width)
}

func (s *Feedback) renderDetail(width, height int) string {
	cur := s.currentFeedback()
	if cur == nil {
		return centerMsg(Size{Width: width, Height: height}, "select feedback")
	}
	header := shell.PaneHeader(width, "Feedback "+cur.ID, cur.Status, shell.TextMuted.Render(relTime(cur.CreatedAt)))
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	b.WriteString(" " + shell.SectionTag.Render("LINKED"))
	b.WriteString("\n")
	if cur.TraceID != nil {
		b.WriteString(kvRow("trace", *cur.TraceID, width))
	}
	if cur.ExperimentID != nil {
		b.WriteString(kvRow("experiment", *cur.ExperimentID, width))
	}
	if cur.CaseID != nil {
		b.WriteString(kvRow("case", *cur.CaseID, width))
	}

	b.WriteString("\n " + shell.SectionTag.Render("RATING"))
	b.WriteString("\n")
	rating := "(none)"
	if cur.Rating != nil {
		rating = fmt.Sprintf("%d", *cur.Rating)
	}
	b.WriteString(kvRow("score", rating, width))

	if cur.Comment != nil && *cur.Comment != "" {
		b.WriteString("\n " + shell.SectionTag.Render("COMMENT"))
		b.WriteString("\n")
		b.WriteString(boxedPre(*cur.Comment, width-2))
	}

	if len(cur.Tags) > 0 {
		b.WriteString("\n " + shell.SectionTag.Render("TAGS") + "\n ")
		b.WriteString(shell.TextDim.Render(strings.Join(cur.Tags, ", ")))
	}

	footer := shell.PaneFooter(width, []shell.Keybind{
		shell.Bind("↵", "open run"), shell.Bind("f", "filter"), shell.Bind("x", "dismiss"),
	})
	hdrH := strings.Count(header, "\n") + 1
	footerH := strings.Count(footer, "\n") + 1
	body := kit.PadBlock(b.String(), width, height-hdrH-footerH+1)
	return body + "\n" + footer
}

func (s *Feedback) move(delta int) {
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

func (s *Feedback) currentFeedback() *api.QualityFeedbackRecord {
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

type feedbackLoadedMsg []api.QualityFeedbackRecord

func fetchFeedback(c DataClient) tea.Cmd {
	return func() tea.Msg {
		recs, err := c.Feedback(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return feedbackLoadedMsg(recs)
	}
}
