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

// Cassettes — 2-pane over the executor-boundary cassette files under
// `.crux/quality/cassettes/`:
//
//	list (name · entries · STALE marker · age)
//	│
//	detail (path · sdk version · models · size · recorded-at · staleness note)
//
// Entries are deliberately not listed: they carry recorded model output and
// can be megabytes. Re-recording is a CLI workflow
// (`crux quality run --replay refresh`), not a TUI write.
type Cassettes struct {
	items        []api.QualityCassetteFileRecord
	selectedPath string
	loaded       bool
	err          string
}

func NewCassettes() *Cassettes { return &Cassettes{} }

func (s *Cassettes) ID() string                { return "cassettes" }
func (s *Cassettes) Init(c DataClient) tea.Cmd { return fetchCassetteFiles(c) }
func (s *Cassettes) Counts() map[string]int    { return map[string]int{"cassettes": len(s.items)} }
func (s *Cassettes) Interested(domains bridge.Domains) bool {
	return domains.Has(bridge.DomainCassettes)
}

func (s *Cassettes) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case cassettesLoadedMsg:
		s.items = []api.QualityCassetteFileRecord(m)
		s.loaded = true
		if s.currentCassette() == nil && len(s.items) > 0 {
			s.selectedPath = s.items[0].Path
		}
	case api.QualityEvent:
		return fetchCassetteFiles(c)
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyPressMsg:
		switch m.String() {
		case "j", "down":
			s.move(1)
		case "k", "up":
			s.move(-1)
		}
	}
	return nil
}

func (s *Cassettes) Breadcrumb() ([]string, string) {
	path := []string{"cassettes"}
	if s.selectedPath != "" {
		path = append(path, baseName(s.selectedPath))
	}
	return path, fmt.Sprintf("%d cassettes", len(s.items))
}

func (s *Cassettes) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		shell.Bind("j/k", "move"),
		shell.Bind(":", "cmd"), shell.Bind("?", "help"),
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
		return centerMsg(size, "no cassettes recorded yet — run `crux quality run --replay record`.")
	}
	listW := size.Width * 36 / 100
	if listW < 40 {
		listW = 40
	}
	detailW := size.Width - listW - 1
	list := s.renderList(listW, size.Height)
	detail := s.renderDetail(detailW, size.Height)
	return kit.ComposeColumns(
		kit.PadBlock(list, listW, size.Height),
		kit.PadBlock(detail, detailW, size.Height),
	)
}

func (s *Cassettes) renderList(width, height int) string {
	stale := 0
	for _, c := range s.items {
		if c.Stale {
			stale++
		}
	}
	right := shell.TextMuted.Render("all fresh")
	if stale > 0 {
		right = shell.Amber.Render(fmt.Sprintf("%d stale", stale))
	}
	header := shell.PaneHeader(width, "Cassettes", fmt.Sprintf("%d", len(s.items)), right)
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")
	count := 0
	for _, c := range s.items {
		if count+2 > bodyRows {
			break
		}
		b.WriteString(s.renderListRow(c, width, c.Path == s.selectedPath))
		b.WriteString("\n")
		count += 2
	}
	for ; count < bodyRows; count++ {
		b.WriteString(strings.Repeat(" ", width) + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Cassettes) renderListRow(c api.QualityCassetteFileRecord, width int, selected bool) string {
	stateGlyph := shell.Green.Render("●")
	if c.Stale {
		stateGlyph = shell.Amber.Render("◐")
	}
	bar := " "
	if selected {
		bar = lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▌")
	}
	name := shell.Text.Render(truncate(c.Name, width-22))
	age := shell.TextMuted.Render(relTime(c.RecordedAt))
	line1 := fmt.Sprintf("%s%s %s  %s", bar, stateGlyph, name, age)
	meta := shell.TextMuted.Render(fmt.Sprintf("%d entries", c.EntryCount))
	if c.Stale {
		meta += " · " + shell.Amber.Render("STALE")
	}
	line2 := "    " + meta
	return padRow(line1, width) + "\n" + padRow(line2, width)
}

func (s *Cassettes) renderDetail(width, height int) string {
	cur := s.currentCassette()
	if cur == nil {
		return centerMsg(Size{Width: width, Height: height}, "select a cassette")
	}

	subtitle := fmt.Sprintf("%d entries · %s", cur.EntryCount, formatBytes(cur.SizeBytes))
	if cur.Stale {
		subtitle += " · " + shell.Amber.Render("stale")
	}
	header := shell.PaneHeader(width, cur.Name, subtitle, "")
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	b.WriteString(" " + shell.SectionTag.Render("FILE"))
	b.WriteString("\n")
	b.WriteString(kvRow("path", cur.Path, width))
	b.WriteString(kvRow("recorded", cur.RecordedAt, width))
	b.WriteString(kvRow("sdk", cur.SdkVersion, width))
	b.WriteString(kvRow("size", formatBytes(cur.SizeBytes), width))
	b.WriteString(kvRow("entries", fmt.Sprintf("%d", cur.EntryCount), width))

	if len(cur.Models) > 0 {
		b.WriteString("\n " + shell.SectionTag.Render("MODELS"))
		b.WriteString("\n")
		for _, m := range cur.Models {
			b.WriteString(padRow(" "+shell.TextDim.Render(m), width))
			b.WriteString("\n")
		}
	}

	if cur.Stale {
		b.WriteString("\n " + shell.SectionTag.Render("STALENESS"))
		b.WriteString("\n")
		b.WriteString(padRow(" "+shell.Amber.Render("recorded more than 90 days ago — replay refuses stale tapes."), width))
		b.WriteString("\n")
		b.WriteString(padRow(" "+shell.TextDim.Render("re-record with `crux quality run --replay refresh`."), width))
		b.WriteString("\n")
	}

	hdrH := strings.Count(header, "\n") + 1
	return kit.PadBlock(b.String(), width, height-hdrH+1)
}

func formatBytes(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
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

func (s *Cassettes) currentCassette() *api.QualityCassetteFileRecord {
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

func baseName(p string) string {
	if idx := strings.LastIndex(p, "/"); idx >= 0 {
		return p[idx+1:]
	}
	return p
}

// --- fetch -------------------------------------------------------------------

type cassettesLoadedMsg []api.QualityCassetteFileRecord

func fetchCassetteFiles(c DataClient) tea.Cmd {
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		recs, err := c.CassetteFiles(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return cassettesLoadedMsg(recs)
	}
}
