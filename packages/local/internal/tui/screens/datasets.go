package screens

import (
	"fmt"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type datasetsFocus int

const (
	datasetsFocusSuites datasetsFocus = iota
	datasetsFocusCases
	datasetsFocusEditor
)

// Datasets renders Quality suites and a local case editor.
//
// Persistence is intentionally absent in this phase: the repository has suite
// record types and `qualityfs` storage, but no service-backed TUI upsert
// contract yet. Phase 20 owns that write surface. Until then this screen keeps
// edits local, exposes dirty/undo/discard behavior, and hides save key hints.
type Datasets struct {
	suites        []api.QualitySuiteRecord
	selectedSuite string
	selectedCase  string
	loaded        bool
	pending       bool
	err           string
	notice        string
	focus         datasetsFocus
	editorField   datasetField
	draft         api.QualitySuiteCase
	original      api.QualitySuiteCase
	undo          []api.QualitySuiteCase
	dirty         bool
	confirmLeave  bool
}

func NewDatasets() *Datasets {
	return &Datasets{focus: datasetsFocusSuites, editorField: datasetFieldInput}
}

func (s *Datasets) ID() string { return "datasets" }

func (s *Datasets) Init(c DataClient) tea.Cmd { return fetchDatasets(c) }

func (s *Datasets) Counts() map[string]int { return map[string]int{"datasets": s.caseCount()} }

func (s *Datasets) Interested(domains bridge.Domains) bool {
	return domains.Has(bridge.DomainSuites)
}

func (s *Datasets) Editing() bool { return s.focus == datasetsFocusEditor }

func (s *Datasets) Focus(kind, id string) {
	if kind != "dataset" || id == "" {
		return
	}
	s.selectedSuite = id
	s.focus = datasetsFocusCases
}

func (s *Datasets) Update(msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case datasetsLoadedMsg:
		s.applySuites([]api.QualitySuiteRecord(m))
	case datasetsPendingMsg:
		s.loaded = true
		s.pending = true
		s.notice = string(m)
	case dataErrMsg:
		s.loaded = true
		s.err = string(m)
	case api.QualityEvent:
		return fetchDatasets(c)
	case tea.KeyPressMsg:
		return s.updateKey(m)
	}
	return nil
}

func (s *Datasets) updateKey(msg tea.KeyPressMsg) tea.Cmd {
	switch msg.String() {
	case "h", "left":
		s.focusLeft()
	case "l", "right", "enter":
		s.focusRight()
	case "j", "down":
		s.move(1)
	case "k", "up":
		s.move(-1)
	case "tab":
		if s.focus == datasetsFocusEditor {
			s.nextField()
		} else {
			s.focusRight()
		}
	case "esc":
		s.escape()
	case "ctrl+z":
		s.undoEdit()
	case "a":
		s.addAssertion()
	case "x":
		s.deleteAssertion()
	case "d":
		s.duplicateCase()
	case "n":
		s.notice = "add case from trace needs a picker/upsert surface (Phase 20)"
	case "r":
		s.notice = "re-run case needs a service action surface (Phase 20)"
	case "ctrl+s":
		s.notice = "save/upsert needs a service action surface (Phase 20)"
	default:
		s.applyText(msg.Text)
	}
	return nil
}

func (s *Datasets) Breadcrumb() ([]string, string) {
	path := []string{"datasets"}
	if s.selectedSuite != "" {
		path = append(path, s.selectedSuite)
	}
	if s.selectedCase != "" {
		path = append(path, s.selectedCase)
	}
	right := fmt.Sprintf("%d cases", s.caseCount())
	if s.dirty {
		right = shell.Amber.Render("unsaved") + " · " + right
	}
	return path, right
}

func (s *Datasets) Keybinds() []shell.Keybind {
	binds := []shell.Keybind{
		shell.Bind("j/k", "move"),
		shell.Bind("h/l", "pane"),
		shell.Bind("tab", "field"),
		shell.Bind("^z", "undo"),
	}
	if s.focus == datasetsFocusEditor {
		binds = append(binds, shell.Bind("a", "assert"), shell.Bind("d", "duplicate"))
		if s.dirty {
			binds = append(binds, shell.Bind("esc", "discard"))
		}
	}
	return append(binds, shell.Bind(":", "cmd"), shell.Bind("?", "help"))
}

func (s *Datasets) applySuites(items []api.QualitySuiteRecord) {
	s.suites = items
	s.loaded = true
	s.pending = false
	if s.selectedSuite == "" && len(items) > 0 {
		s.selectedSuite = items[0].SuiteID
	}
	if s.currentSuite() == nil && len(items) > 0 {
		s.selectedSuite = items[0].SuiteID
	}
	s.ensureCaseSelection()
}

func (s *Datasets) ensureCaseSelection() {
	suite := s.currentSuite()
	if suite == nil || len(suite.Cases) == 0 {
		s.selectedCase = ""
		s.loadDraft(api.QualitySuiteCase{})
		return
	}
	if s.selectedCase == "" || s.currentCase() == nil {
		s.selectedCase = suite.Cases[0].CaseID
	}
	if cur := s.currentCase(); cur != nil {
		s.loadDraft(*cur)
	}
}

func (s *Datasets) loadDraft(testCase api.QualitySuiteCase) {
	s.draft = cloneDatasetCase(testCase)
	s.original = cloneDatasetCase(testCase)
	s.undo = nil
	s.dirty = false
	s.confirmLeave = false
}

func (s *Datasets) caseCount() int {
	total := 0
	for _, suite := range s.suites {
		total += len(suite.Cases)
	}
	return total
}
