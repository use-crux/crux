package screens

import (
	"context"
	"fmt"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var experimentsStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

type experimentsFocus int

const (
	expFocusList experimentsFocus = iota
	expFocusDetail
)

// Experiments renders evaluation experiment records and their variant metrics.
//
// The screen is intentionally a thin state machine: reads flow through
// DataClient, live invalidation comes from the bridge, and rendering is
// delegated to rect-bounded kit components.
type Experiments struct {
	items      []api.QualityExperimentSummary
	selectedID string
	detail     *api.QualityExperimentDetail
	progress   *api.QualityEvaluationProgress
	loaded     bool
	err        string
	notice     string
	focus      experimentsFocus
	cellIdx    int
	table      *kit.Table[api.QualityExperimentSummary]
}

func NewExperiments() *Experiments {
	s := &Experiments{table: newExperimentsTable()}
	s.table.SetIdentity(func(e api.QualityExperimentSummary) string { return e.ExperimentID })
	return s
}

func (s *Experiments) ID() string { return "experiments" }

func (s *Experiments) Interested(domains bridge.Domains) bool {
	return domains.Has(bridge.DomainExperiments)
}

func (s *Experiments) Init(c DataClient) tea.Cmd {
	return tea.Batch(fetchExperimentSummaries(c), s.fetchDetail(c), s.fetchProgress(c))
}

func (s *Experiments) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case experimentsListLoadedMsg:
		s.applySummaries([]api.QualityExperimentSummary(m))
		return tea.Batch(s.fetchDetail(c), s.fetchProgress(c))
	case experimentDetailLoadedMsg:
		s.applyDetail(m)
	case experimentProgressLoadedMsg:
		s.applyProgress(m)
	case experimentPromotedMsg:
		s.notice = fmt.Sprintf("baseline %s promoted -> %s", m.result.BaselineID, m.result.Path)
		return fetchExperimentSummaries(c)
	case experimentExportedMsg:
		s.notice = fmt.Sprintf("exported %s -> %s", m.experimentID, m.path)
	case api.QualityEvent:
		return tea.Batch(fetchExperimentSummaries(c), s.fetchDetail(c), s.fetchProgress(c))
	case dataErrMsg:
		s.err = string(m)
	case tea.KeyPressMsg:
		return s.updateKey(m, c)
	}
	return nil
}

func (s *Experiments) updateKey(msg tea.KeyPressMsg, c DataClient) tea.Cmd {
	switch msg.String() {
	case "j", "down":
		s.move(1)
		return tea.Batch(s.fetchDetail(c), s.fetchProgress(c))
	case "k", "up":
		s.move(-1)
		return tea.Batch(s.fetchDetail(c), s.fetchProgress(c))
	case "l", "right":
		s.focus = expFocusDetail
	case "h", "left", "esc":
		s.focus = expFocusList
	case "enter":
		return s.openRun()
	case "p":
		return s.promote(c)
	case "e":
		return s.exportExperiment()
	}
	return nil
}

func (s *Experiments) applySummaries(items []api.QualityExperimentSummary) {
	s.items = items
	s.table.SetItems(items)
	if s.selectedID == "" && len(items) > 0 {
		s.selectedID = items[0].ExperimentID
	}
	if s.selectedID != "" && !s.table.SetCursorByIdentity(s.selectedID) && len(items) > 0 {
		s.selectedID = items[0].ExperimentID
		s.table.SetCursorByIdentity(s.selectedID)
	}
	s.loaded = true
}

func (s *Experiments) applyDetail(msg experimentDetailLoadedMsg) {
	if msg.experimentID != s.selectedID || !msg.found {
		return
	}
	detail := msg.detail
	s.detail = &detail
	s.cellIdx = 0
}

func (s *Experiments) applyProgress(msg experimentProgressLoadedMsg) {
	if !msg.found || msg.progress.EvaluationID == "" {
		return
	}
	progress := msg.progress
	s.progress = &progress
}

func (s *Experiments) move(delta int) {
	if len(s.items) == 0 {
		return
	}
	if delta < 0 {
		s.table.CursorUp()
	} else {
		s.table.CursorDown()
	}
	if cur, _, ok := s.table.Cursor(); ok && cur.ExperimentID != s.selectedID {
		s.selectedID = cur.ExperimentID
		s.detail = nil
		s.progress = nil
		s.notice = ""
		s.cellIdx = 0
	}
}

func (s *Experiments) Breadcrumb() ([]string, string) {
	path := []string{"experiments"}
	if s.selectedID != "" {
		path = append(path, shortID(s.selectedID, 12))
	}
	return path, fmt.Sprintf("%d experiments", len(s.items))
}

func (s *Experiments) Keybinds() []shell.Keybind {
	return []shell.Keybind{
		shell.Bind("j/k", "move"),
		shell.Bind("h/l", "pane"),
		shell.Bind("↵", "open run"),
		shell.Bind("p", "promote"),
		shell.Bind("e", "export CSV"),
		shell.Bind(":", "cmd"),
		shell.Bind("?", "help"),
	}
}

func (s *Experiments) Counts() map[string]int {
	return map[string]int{"experiments": len(s.items)}
}

func (s *Experiments) Focus(kind, id string) {
	if kind != "experiment" || id == "" {
		return
	}
	s.selectedID = id
	s.detail = nil
	s.progress = nil
	s.cellIdx = 0
	s.table.SetCursorByIdentity(id)
}

func (s *Experiments) currentSummary() *api.QualityExperimentSummary {
	for i, item := range s.items {
		if item.ExperimentID == s.selectedID {
			return &s.items[i]
		}
	}
	if len(s.items) == 0 {
		return nil
	}
	return &s.items[0]
}

func (s *Experiments) promote(c DataClient) tea.Cmd {
	cur := s.currentSummary()
	if cur == nil || c == nil {
		return nil
	}
	expID := cur.ExperimentID
	variant := s.winnerVariant()
	return func() tea.Msg {
		res, err := c.PromoteBaseline(context.Background(), expID, variant, "")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentPromotedMsg{result: res}
	}
}

func (s *Experiments) openRun() tea.Cmd {
	cells := s.failingCells()
	if s.focus != expFocusDetail || len(cells) == 0 || s.cellIdx >= len(cells) {
		return nil
	}
	if len(cells[s.cellIdx].TraceIDs) == 0 || cells[s.cellIdx].TraceIDs[0] == "" {
		return nil
	}
	traceID := cells[s.cellIdx].TraceIDs[0]
	return func() tea.Msg {
		return NavigateRequest{NavID: "runs", Kind: "run", ID: traceID}
	}
}

type experimentPromotedMsg struct {
	result api.QualityPromoteResult
}
