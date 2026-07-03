package screens

import (
	"fmt"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var runsStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

// Runs screen — three panes laid out per the V1 Panels design:
//
//	┌──────────────┬─────────────────────────────────────────┬──────────────────────┐
//	│ Runs · 1h    │ Trace 8af2…f1c · docs_agent · 14.2s     │ span: retrieve(loop) │
//	│ sort: time ↓ │ 0s  1s  2s  …  14.2s                    │ 9.8s                 │
//	│              │ ◆ agent  docs_agent.run  ━━━━━━━━ 14.20s│ IDENTITY             │
//	│ ● 8af2f1c    │ ├ llm    plan            │       0.62s  │ span_id  b71c…3a4f   │
//	│   docs_agent │ ├ agent  retrieve(loop)  ━━━━━   9.80s  │ parent   8af2…f1c    │
//	│   14.2s      │ ├ tool   rag.search …    │       0.54s  │ kind     agent.sub…  │
//	│   18.4k tok  │ …                                       │ op       agent       │
//	│              │ [↵] expand [o] open [f] flame chart …   │ TIMING   …           │
//	└──────────────┴─────────────────────────────────────────┴──────────────────────┘
//
// Focus moves with h/l. j/k cycles within the focused pane; ↵ activates
// (loads run detail from the list, drills into span detail from the
// waterfall).
type Runs struct {
	runs    []api.QualityRunRecord
	detail  *api.QualityRunDetailRecord
	selRun  string
	selSpan string
	focus   runsFocus
	loaded  bool
	err     string
	loading bool

	runList        kit.VList[api.QualityRunRecord]
	filteringRuns  bool
	runQuery       string
	runStatusIndex int
	expandedDups   map[string]bool
	renderRev      uint64
	memo           kit.Memo
}

type runsFocus int

const (
	focusRuns runsFocus = iota
	focusWaterfall
	focusSpanDetail
)

func NewRuns() *Runs {
	r := &Runs{}
	r.runList.SetIdentity(func(run api.QualityRunRecord) string { return run.TraceID })
	r.runList.SetRowHeight(func(api.QualityRunRecord) int { return 2 })
	return r
}

func (s *Runs) ID() string { return "runs" }

func (s *Runs) Interested(domains bridge.Domains) bool {
	return domains.Has(bridge.DomainRuns)
}

func (s *Runs) Init(c DataClient) tea.Cmd { return fetchRunsList(c) }

func (s *Runs) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case runsListLoadedMsg:
		s.runs = []api.QualityRunRecord(m)
		s.runList.SetItems(s.runs)
		s.loaded = true
		s.bumpRenderRev()
		if s.selRun == "" && len(s.runs) > 0 {
			s.selRun = s.runs[0].TraceID
			s.runList.SetCursorByIdentity(s.selRun)
			return fetchRunDetail(c, s.selRun)
		}
		s.runList.SetCursorByIdentity(s.selRun)
	case runDetailLoadedMsg:
		d := api.QualityRunDetailRecord(m)
		// Preserve the user's span selection across refetches when the
		// span still exists.
		prevSel := s.selSpan
		s.detail = &d
		s.loading = false
		s.selSpan = ""
		for _, sp := range d.Spans {
			if sp.ID == prevSel {
				s.selSpan = prevSel
				break
			}
		}
		if s.selSpan == "" && len(d.Spans) > 0 {
			s.selSpan = d.Spans[0].ID
		}
		s.bumpRenderRev()
	case dataErrMsg:
		s.err = string(m)
		s.loading = false
		s.bumpRenderRev()
	case api.QualityEvent:
		// Typed live event from the bus (also used for the synthesized
		// "store changed" signal — kind=="refresh"). Refresh the run list
		// and refetch the active trace's detail when relevant.
		return s.liveRefresh(c, m.RefID)
	case tea.KeyPressMsg:
		if s.filteringRuns {
			return s.updateRunFilter(m, c)
		}
		switch m.String() {
		case "j", "down":
			return s.moveDown(c)
		case "k", "up":
			return s.moveUp(c)
		case "h", "left":
			s.shiftFocus(-1)
		case "l", "right":
			s.shiftFocus(+1)
		case "enter":
			return s.activateFocus(c)
		case "/":
			if s.focus == focusRuns {
				s.filteringRuns = true
			}
		case "f":
			if s.focus == focusRuns {
				return s.cycleRunStatusFilter(c)
			}
		case "i":
			// Raw-inspect overlay (in-TUI JSON pretty-printer). Layer-3
			// per KEYBINDS.md; `o` is reserved for external viewer.
			return s.openInspect()
		case "o":
			// Open in external React devtools UI — stub for now; S7 wires
			// the actual handoff once the URL scheme is documented.
			return nil
		case "e":
			// export: dump the focused run's JSON to
			// ~/.crux/exports/run-{id}.json. No-op if nothing focused.
			return s.exportRun()
		}
	}
	return nil
}

func (s *Runs) openInspect() tea.Cmd {
	span := s.currentSpan()
	if span == nil || len(span.Data) == 0 {
		return nil
	}
	title := span.Name
	if title == "" {
		title = span.ID
	}
	subtitle := span.Primitive
	if span.CompositionType != "" {
		subtitle += " · " + span.CompositionType
	}
	payload := span.Data
	return func() tea.Msg {
		return InspectRequest{
			Title:    title,
			Subtitle: subtitle,
			Payload:  []byte(payload),
		}
	}
}

// liveRefresh refetches the runs list and, if the event references the
// currently-selected trace (or the refId is empty so we can't be sure),
// also refetches that trace's detail. Returning batched commands keeps
// the screen in sync without losing focus or selection state.
func (s *Runs) liveRefresh(c DataClient, refID string) tea.Cmd {
	cmds := []tea.Cmd{fetchRunsList(c)}
	if s.selRun != "" && (refID == "" || refID == s.selRun) {
		cmds = append(cmds, fetchRunDetail(c, s.selRun))
	}
	return tea.Batch(cmds...)
}

func (s *Runs) shiftFocus(delta int) {
	next := int(s.focus) + delta
	if next < 0 {
		next = 0
	}
	if next > int(focusSpanDetail) {
		next = int(focusSpanDetail)
	}
	s.focus = runsFocus(next)
}

func (s *Runs) activateFocus(c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		if s.selRun == "" {
			return nil
		}
		s.loading = true
		s.detail = nil
		return fetchRunDetail(c, s.selRun)
	case focusWaterfall:
		if s.toggleSelectedDuplicateGroup() {
			return nil
		}
		s.focus = focusSpanDetail
	}
	return nil
}

func (s *Runs) Breadcrumb() ([]string, string) {
	path := []string{"runs"}
	if s.selRun != "" {
		path = append(path, "run "+truncate(s.selRun, 8))
	}
	if cur := s.currentSpan(); cur != nil && s.focus == focusSpanDetail {
		path = append(path, "span: "+cur.Name)
	}
	right := ""
	if s.loaded {
		right = fmt.Sprintf("%d runs · last 1h", len(s.runs))
	}
	return path, right
}

func (s *Runs) Keybinds() []shell.Keybind {
	jkLabel := "span"
	if s.focus == focusRuns {
		jkLabel = "run"
	}
	return []shell.Keybind{
		shell.Bind("j/k", jkLabel),
		shell.Bind("h/l", "pane"),
		shell.Bind("↵", focusActionLabel(s.focus)),
		shell.Bind("i", "inspect raw"),
		shell.Bind("o", "open in viewer"),
		shell.Bind(":", "cmd"),
		shell.Bind("?", "help"),
		shell.Bind("q", "quit"),
	}
}

// focusTitle prefixes a teal `▸` accent + bold teal text to the pane title
// when that pane is focused, so the user can see which pane j/k will affect.
func focusTitle(title string, focused bool) string {
	if focused {
		return lipgloss.NewStyle().Foreground(shell.ColorTeal).Render("▸ ") +
			lipgloss.NewStyle().Foreground(shell.ColorTeal).Bold(true).Render(title)
	}
	return title
}

func focusActionLabel(f runsFocus) string {
	switch f {
	case focusRuns:
		return "load run"
	case focusWaterfall:
		return "span detail"
	default:
		return "open"
	}
}

func (s *Runs) Counts() map[string]int { return map[string]int{"runs": len(s.runs)} }
