package screens

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/colorprofile"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/theme"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

var insightsStyles = theme.NewStyles(theme.Resolve(colorprofile.TrueColor))

type insightsFocus int

const (
	focusInsightsList insightsFocus = iota
	focusInsightsDetail
)

// Insights renders the derived-insights workbench screen.
//
// The screen owns only interaction state. Data is loaded through DataClient,
// live updates arrive through the bridge interest contract, and all rendering
// is bounded by the Rects supplied by the kit layout engine.
type Insights struct {
	insightsResource *resource.Resource[[]api.InspectInsightRecord]
	evalRunsResource *resource.Resource[[]json.RawMessage]
	items            []api.InspectInsightRecord
	evalRuns         []evalRunItem
	selectedID       string
	loaded           bool
	err              string
	evalEvidenceErr  string
	tab              string
	focus            insightsFocus
	list             kit.VList[api.InspectInsightRecord]
}

func NewInsights() *Insights {
	s := &Insights{
		insightsResource: resource.New(func(items []api.InspectInsightRecord) bool { return len(items) == 0 }),
		evalRunsResource: resource.New(func(runs []json.RawMessage) bool { return len(runs) == 0 }),
		tab:              "diagnosis",
	}
	s.list.SetIdentity(func(ins api.InspectInsightRecord) string { return ins.InsightID })
	s.list.SetRowHeight(func(api.InspectInsightRecord) int { return 2 })
	return s
}

func (s *Insights) ID() string { return "insights" }

func (s *Insights) Init(ctx context.Context, client DataClient) tea.Cmd {
	return s.fetchData(ctx, client)
}

func (s *Insights) Deactivate() bridge.Invalidations {
	invalidations := bridge.Invalidations{}
	cancelPendingResource(invalidations, bridge.InsightsListResource, s.insightsResource)
	cancelPendingResource(invalidations, bridge.InsightsEvalRunsResource, s.evalRunsResource)
	// Cases evidence is a focus-scoped projection. Always refresh it when the
	// user returns so completed evidence cannot remain stale across navigation.
	invalidations.Add(bridge.InsightsEvalRunsResource, s.evalRunsResource.Snapshot().Token.Revision)
	return invalidations
}

func (s *Insights) Refresh(ctx context.Context, client DataClient, invalidations bridge.Invalidations) tea.Cmd {
	commands := make([]tea.Cmd, 0, 2)
	listRevision, listInvalid := invalidations.Revision(bridge.InsightsListResource)
	if listInvalid || s.insightsResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, s.fetchInsightsList(ctx, client, listRevision))
	}
	evalRevision, evalInvalid := invalidations.Revision(bridge.InsightsEvalRunsResource)
	if evalInvalid || s.evalRunsResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, s.fetchInsightsEvalRuns(ctx, client, evalRevision))
	}
	return tea.Batch(commands...)
}

func (s *Insights) Update(ctx context.Context, msg tea.Msg, client DataClient) tea.Cmd {
	switch m := msg.(type) {
	case insightsListLoadedMsg:
		if !s.insightsResource.Apply(resource.ResourceResult[[]api.InspectInsightRecord](m)) {
			return nil
		}
		snapshot := s.insightsResource.Snapshot()
		s.loaded = snapshot.State != resource.ResourceLoading && snapshot.State != resource.ResourceIdle
		s.err = ""
		if snapshot.Err != nil {
			s.err = snapshot.Err.Error()
		}
		if snapshot.HasValue {
			s.applyInsights(snapshot.Value)
		}
	case insightsEvalRunsLoadedMsg:
		if !s.evalRunsResource.Apply(resource.ResourceResult[[]json.RawMessage](m)) {
			return nil
		}
		snapshot := s.evalRunsResource.Snapshot()
		s.evalEvidenceErr = ""
		if snapshot.Err != nil {
			s.evalEvidenceErr = snapshot.Err.Error()
		}
		if snapshot.HasValue {
			s.evalRuns = projectEvalRuns(snapshot.Value)
		}
	case dataErrMsg:
		s.err = string(m)
	case insightStatusMsg:
		for index := range s.items {
			if s.items[index].InsightID == m.id {
				s.items[index].Status = m.status
				break
			}
		}
		s.list.SetItems(s.items)
	case tea.KeyPressMsg:
		return s.updateKey(ctx, m, client)
	}
	return nil
}

func (s *Insights) updateKey(ctx context.Context, msg tea.KeyPressMsg, client DataClient) tea.Cmd {
	cmd, _ := interaction.Dispatch(s.Actions(ctx, client), msg)
	return cmd
}

func (s *Insights) applyInsights(items []api.InspectInsightRecord) {
	s.items = items
	s.list.SetItems(items)
	if s.selectedID == "" && len(items) > 0 {
		s.selectedID = items[0].InsightID
	}
	if s.selectedID != "" && !s.list.SetCursorByIdentity(s.selectedID) && len(items) > 0 {
		s.selectedID = items[0].InsightID
		s.list.SetCursorByIdentity(s.selectedID)
	}
	s.loaded = true
}

func (s *Insights) shiftFocus(delta int) {
	next := int(s.focus) + delta
	if next < int(focusInsightsList) {
		next = int(focusInsightsList)
	}
	if next > int(focusInsightsDetail) {
		next = int(focusInsightsDetail)
	}
	s.focus = insightsFocus(next)
}

func (s *Insights) moveSelection(delta int) {
	if len(s.items) == 0 {
		return
	}
	if delta < 0 {
		s.list.CursorUp()
	} else {
		s.list.CursorDown()
	}
	if cur, _, ok := s.list.Cursor(); ok {
		s.selectedID = cur.InsightID
	}
}

func (s *Insights) cycleTab(delta int) {
	tabs := []string{"diagnosis", "traces", "cases", "fix"}
	idx := 0
	for i, tab := range tabs {
		if tab == s.tab {
			idx = i
			break
		}
	}
	idx = (idx + delta + len(tabs)) % len(tabs)
	s.tab = tabs[idx]
}

func (s *Insights) Breadcrumb() ([]string, string) {
	path := []string{"insights"}
	if s.selectedID != "" {
		path = append(path, s.selectedID)
	}
	right := ""
	if s.loaded {
		right = fmt.Sprintf("%d open", s.openCount())
	}
	return path, right
}

func (s *Insights) Keybinds() []shell.Keybind {
	return actionKeybinds(s.Actions(context.TODO(), nil), nil)
}

func (s *Insights) Counts() map[string]int {
	return map[string]int{"insights": s.openCount()}
}

func (s *Insights) Focus(kind, id string) {
	if kind != "insight" || id == "" {
		return
	}
	s.selectedID = id
	s.list.SetCursorByIdentity(id)
}

func (s *Insights) openCount() int {
	open := 0
	for _, it := range s.items {
		if it.Status != "dismissed" && it.Status != "resolved" {
			open++
		}
	}
	return open
}

func (s *Insights) currentInsight() *api.InspectInsightRecord {
	for i, it := range s.items {
		if it.InsightID == s.selectedID {
			return &s.items[i]
		}
	}
	if len(s.items) == 0 {
		return nil
	}
	return &s.items[0]
}

func (s *Insights) openLinkedTrace() tea.Cmd {
	cur := s.currentInsight()
	if cur == nil || len(cur.LinkedTraceIDs) == 0 {
		return nil
	}
	runID := cur.LinkedTraceIDs[0]
	return func() tea.Msg {
		return NavigateRequest{NavID: "runs", Kind: "run", ID: runID}
	}
}

func (s *Insights) dismiss(ctx context.Context, client DataClient) tea.Cmd {
	return s.setInsightStatus(ctx, client, "dismissed")
}

func (s *Insights) markFixed(ctx context.Context, client DataClient) tea.Cmd {
	return s.setInsightStatus(ctx, client, "resolved")
}

func (s *Insights) setInsightStatus(ctx context.Context, client DataClient, status string) tea.Cmd {
	cur := s.currentInsight()
	if cur == nil || client == nil {
		return nil
	}
	id := cur.InsightID
	return func() tea.Msg {
		_, err := client.SetInsightStatus(ctx, id, api.InspectInsightStatusRequest{Status: status})
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightStatusMsg{id: id, status: status}
	}
}

func (s *Insights) exportInsight() tea.Cmd {
	cur := s.currentInsight()
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
		path := filepath.Join(dir, "insight-"+truncate(rec.InsightID, 32)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return insightExportedMsg{insightID: rec.InsightID, path: path}
	}
}

type insightStatusMsg struct {
	id     string
	status string
}

type insightExportedMsg struct {
	insightID string
	path      string
}
