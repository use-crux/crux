package screens

import (
	"context"
	"encoding/json"
	"fmt"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
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
//	│              │ [↵] span detail [i] inspect [x] export  │ TIMING   …           │
//	└──────────────┴─────────────────────────────────────────┴──────────────────────┘
//
// Focus moves with h/l. j/k cycles within the focused pane; ↵ activates
// (loads run detail from the list, drills into span detail from the
// waterfall).
type Runs struct {
	runsResource    *resource.Resource[[]api.ObservabilityRunSummary]
	detailResource  *resource.Resource[api.ObservabilityRunDetail]
	routedRun       *api.ObservabilityRunSummary
	pendingLocation *pendingRunsLocation
	diagnosis       *RunDiagnosis
	focus           runsFocus

	runList          *kit.ListPane[api.ObservabilityRunSummary]
	spanList         *kit.ListPane[RunRow]
	spanDocument     *kit.DocumentPane
	size             Size
	layout           runsLayout
	definitionFilter string
	filteringRuns    bool
	runQuery         string
	runStatusIndex   int
	expandedRows     map[string]bool
	expandedPayloads map[string]bool
	showAllSpans     bool
	exportState      runExportState
}

type runsFocus int

const (
	focusRuns runsFocus = iota
	focusWaterfall
	focusSpanDetail
)

func NewRuns() *Runs {
	r := &Runs{
		runsResource: resource.New(func(runs []api.ObservabilityRunSummary) bool {
			return len(runs) == 0
		}),
		detailResource: resource.New(func(detail api.ObservabilityRunDetail) bool {
			return detail.Run.RunID == ""
		}),
		runList: kit.NewListPane(func(run api.ObservabilityRunSummary) string {
			return run.RunID
		}),
		spanList: kit.NewListPane(func(row RunRow) string {
			return row.ID
		}),
		spanDocument: kit.NewDocumentPane(),
	}
	r.runList.SetRowHeight(func(api.ObservabilityRunSummary) int { return 2 })
	r.runList.SetFocused(true)
	r.spanList.SetRowHeight(func(RunRow) int { return 1 })
	return r
}

func (s *Runs) ID() string { return "runs" }

func (s *Runs) Editing() bool { return s.filteringRuns }

// Focus selects the exact run identity carried by a navigation target. Runs
// owns this route parameter; display names and legacy workspace selection do
// not participate in resolving it.
func (s *Runs) Focus(kind, id string) {
	if id == "" {
		return
	}
	if kind == "definition" {
		s.definitionFilter = id
		s.clearRunSelection()
		s.runList.SetItems(nil)
		s.runsResource.Cancel()
		return
	}
	if kind != "run" {
		return
	}
	s.definitionFilter = ""
	s.spanList.SetItems(nil)
	s.detailResource.Cancel()
	s.diagnosis = nil
	s.routedRun = nil
	s.pendingLocation = nil
	s.filteringRuns = false
	s.runQuery = ""
	s.runStatusIndex = 0
	s.ensureSelectedRunVisible(id)
	s.runList.SetItems(s.selectableRuns())
	s.runList.Select(id)
}

func (s *Runs) FocusRoot() {
	if s.definitionFilter == "" {
		return
	}
	s.definitionFilter = ""
	s.clearRunSelection()
	s.runList.SetItems(nil)
	s.runsResource.Cancel()
}

// SelectedRunID returns the pane-owned stable identity of the active run.
func (s *Runs) SelectedRunID() string {
	selected, _, ok := s.runList.Selected()
	if !ok {
		return ""
	}
	return selected.RunID
}

// SelectedSpanID returns the hierarchy pane's selected stable span identity.
func (s *Runs) SelectedSpanID() string {
	selected, _, ok := s.spanList.Selected()
	if !ok {
		return ""
	}
	return selected.ID
}

func (s *Runs) Init(ctx context.Context, c DataClient) tea.Cmd { return s.fetchRunsList(ctx, c) }

// Deactivate cancels in-flight list/detail reads and returns the exact names
// that must be retried if Runs is opened again.
func (s *Runs) Deactivate() bridge.Invalidations {
	invalidations := bridge.Invalidations{}
	cancelPendingResource(invalidations, bridge.RunsListResource, s.runsResource)
	detail := s.detailResource.Snapshot()
	if detail.Token.Owner.RecordID != "" {
		cancelPendingResource(invalidations, bridge.RunsDetailResource(detail.Token.Owner.RecordID), s.detailResource)
	}
	s.resizeSpanDocument(s.layout.detail)
	return invalidations
}

// Refresh schedules only invalidated Runs projections, plus resources that
// have never been requested for the current owner.
func (s *Runs) Refresh(ctx context.Context, c DataClient, invalidations bridge.Invalidations) tea.Cmd {
	commands := make([]tea.Cmd, 0, 2)
	listRevision, listInvalid := invalidations.Revision(bridge.RunsListResource)
	if listInvalid || s.runsResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, s.fetchRunsListAtRevision(ctx, c, listRevision))
	} else if s.runsResource.Snapshot().Token.Owner != runsListOwnerForDefinition(s.definitionFilter) {
		commands = append(commands, s.fetchRunsListAtRevision(ctx, c, listRevision))
	}

	selectedID := s.SelectedRunID()
	if selectedID != "" {
		detailRevision, detailInvalid := invalidations.Revision(bridge.RunsDetailResource(selectedID))
		if wildcardRevision, wildcard := invalidations.Revision(bridge.RunsAnyDetailResource); wildcard {
			detailInvalid = true
			detailRevision = maxRevisionFloor(detailRevision, wildcardRevision)
		}
		detailSnapshot := s.detailResource.Snapshot()
		ownerChanged := detailSnapshot.Token.Owner != runsDetailOwner(selectedID)
		if detailInvalid || detailSnapshot.State == resource.ResourceIdle || ownerChanged || !s.selectedDetailIsCurrent() {
			commands = append(commands, s.fetchRunDetailAtRevision(ctx, c, selectedID, detailRevision))
		}
	}
	s.resizeSpanDocument(s.layout.detail)
	return tea.Batch(commands...)
}

func (s *Runs) Update(ctx context.Context, msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case runsListLoadedMsg:
		if !s.runsResource.Apply(resource.ResourceResult[[]api.ObservabilityRunSummary](m)) {
			return nil
		}
		snapshot := s.runsResource.Snapshot()
		if !snapshot.HasValue {
			return nil
		}
		selectedID := s.SelectedRunID()
		if s.routedRun != nil {
			s.ensureSelectedRunVisible(selectedID)
		}
		s.runList.SetItems(s.filteredRuns())
		if selectedID != "" {
			s.runList.Select(selectedID)
		}
		selectedID = s.SelectedRunID()
		if selectedID == "" {
			s.clearRunSelection()
		}
		if !s.selectedDetailIsCurrent() {
			if selectedID == "" {
				return nil
			}
			return s.fetchRunDetail(ctx, c, selectedID)
		}
	case runDetailLoadedMsg:
		return s.applyRunDetail(ctx, resource.ResourceResult[api.ObservabilityRunDetail](m), c)
	case runExportedMsg:
		s.exportState = runExportState{runID: m.runID, message: "exported " + sanitizeRunsInline(m.path)}
	case runExportErrMsg:
		s.exportState = runExportState{runID: s.SelectedRunID(), message: "export failed · " + sanitizeRunsInline(m.err)}
	case tea.KeyPressMsg:
		return s.updateKey(ctx, m, c)
	case tea.MouseWheelMsg:
		if s.filteringRuns {
			return nil
		}
		cmd, _ := s.updateFocusedPaneInput(ctx, m, c)
		return cmd
	}
	return nil
}

func (s *Runs) openInspect() tea.Cmd {
	span := s.currentSpan()
	if span == nil {
		return nil
	}
	payload := span.Data
	if activity := s.currentActivity(); activity != nil {
		payload, _ = json.Marshal(activity)
	}
	if len(payload) == 0 {
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
	return func() tea.Msg {
		return InspectRequest{
			Title:    title,
			Subtitle: subtitle,
			Payload:  []byte(payload),
		}
	}
}

func (s *Runs) shiftFocus(delta int) {
	next := int(s.focus) + delta
	if next < 0 {
		next = 0
	}
	if next > int(focusSpanDetail) {
		next = int(focusSpanDetail)
	}
	s.setFocus(runsFocus(next))
}

func (s *Runs) setFocus(focus runsFocus) {
	s.focus = focus
	s.runList.SetFocused(focus == focusRuns)
	s.spanList.SetFocused(focus == focusWaterfall)
	s.spanDocument.SetFocused(focus == focusSpanDetail)
	s.Resize(s.size)
}

func (s *Runs) activateFocus(ctx context.Context, c DataClient) tea.Cmd {
	switch s.focus {
	case focusRuns:
		selectedID := s.SelectedRunID()
		if selectedID == "" {
			return nil
		}
		return s.fetchRunDetail(ctx, c, selectedID)
	case focusWaterfall:
		if s.toggleSelectedDuplicateGroup() {
			return nil
		}
		s.setFocus(focusSpanDetail)
	}
	return nil
}

func (s *Runs) Breadcrumb() ([]string, string) {
	path := []string{"runs"}
	if s.definitionFilter != "" {
		path = append(path, kit.TruncateMiddle(sanitizeRunsInline(s.definitionFilter), 36, "…"))
	}
	if selected, _, ok := s.runList.Selected(); ok {
		name := firstNonEmpty(selected.Name, selected.RunID)
		path = append(path, kit.TruncateMiddle(sanitizeRunsInline(name), 36, "…"))
	}
	if cur := s.currentSpan(); cur != nil && s.focus == focusSpanDetail {
		path = append(path, "span: "+sanitizeRunsInline(cur.Name))
	}
	right := ""
	listSnapshot := s.runsResource.Snapshot()
	if listSnapshot.HasValue {
		count := len(s.runSummaries())
		right = fmt.Sprintf("%d %s · last 1h", count, kit.Pluralize(count, "run"))
	}
	if exported := s.currentRunExportState(); exported != "" {
		right = exported
	}
	return path, right
}

func (s *Runs) Counts() map[string]int { return map[string]int{"runs": len(s.runSummaries())} }
