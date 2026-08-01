package screens

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type evalsFocus uint8

const (
	evalsFocusCatalog evalsFocus = iota
	evalsFocusGrid
)

type evalRunAvailability struct {
	Checked   bool
	Available bool
}

// Evals is the read-only Eval catalog, run matrix, and Baseline browser.
type Evals struct {
	catalogResource   *resource.Resource[[]json.RawMessage]
	runsResource      *resource.Resource[[]json.RawMessage]
	runResource       *resource.Resource[json.RawMessage]
	baselinesResource *resource.Resource[[]json.RawMessage]
	localRunResource  *resource.Resource[evalRunAvailability]

	catalog   *kit.ListPane[evalCatalogItem]
	detail    *kit.DocumentPane
	items     []evalCatalogItem
	runs      []evalRunItem
	run       evalRunItem
	baselines []evalBaselineItem

	selectedRunID string
	cellRow       int
	cellColumn    int
	focus         evalsFocus
	size          Size
	layout        evalsLayout
	now           func() time.Time
}

func NewEvals() *Evals {
	list := kit.NewListPane(func(item evalCatalogItem) string { return item.ID })
	screen := &Evals{
		catalogResource:   resource.New(func(value []json.RawMessage) bool { return len(value) == 0 }),
		runsResource:      resource.New(func(value []json.RawMessage) bool { return len(value) == 0 }),
		runResource:       resource.New(func(value json.RawMessage) bool { return len(value) == 0 }),
		baselinesResource: resource.New(func(value []json.RawMessage) bool { return len(value) == 0 }),
		localRunResource:  resource.New(func(value evalRunAvailability) bool { return !value.Checked }),
		catalog:           list,
		detail:            kit.NewDocumentPane(),
		now:               time.Now,
	}
	list.SetRowHeight(func(evalCatalogItem) int { return 4 })
	screen.setFocus(evalsFocusCatalog)
	return screen
}

func (s *Evals) ID() string { return "evals" }

func (s *Evals) Init(ctx context.Context, client DataClient) tea.Cmd {
	return tea.Batch(
		s.fetchCatalog(ctx, client, 0),
		s.fetchRuns(ctx, client, 0),
		s.fetchBaselines(ctx, client, 0),
	)
}

func (s *Evals) Deactivate() bridge.Invalidations {
	invalidations := bridge.Invalidations{}
	catalogRevision := s.catalogResource.Snapshot().Token.Revision
	runsRevision := s.runsResource.Snapshot().Token.Revision
	baselinesRevision := s.baselinesResource.Snapshot().Token.Revision
	cancelPendingResource(invalidations, bridge.EvalsCatalogResource, s.catalogResource)
	cancelPendingResource(invalidations, bridge.EvalsRunsResource, s.runsResource)
	invalidations.Add(bridge.EvalsCatalogResource, catalogRevision)
	invalidations.Add(bridge.EvalsRunsResource, runsRevision)
	selectedRunID := s.selectedRunID
	if selectedRunID != "" {
		runRevision := s.runResource.Snapshot().Token.Revision
		cancelPendingResource(invalidations, bridge.EvalsRunResource(selectedRunID), s.runResource)
		invalidations.Add(bridge.EvalsRunResource(selectedRunID), runRevision)
	} else {
		s.runResource.Cancel()
	}
	cancelPendingResource(invalidations, bridge.EvalsBaselinesResource, s.baselinesResource)
	invalidations.Add(bridge.EvalsBaselinesResource, baselinesRevision)
	selectedObservedRunID := s.selectedObservedRunID()
	if selectedObservedRunID != "" {
		localRevision := s.localRunResource.Snapshot().Token.Revision
		cancelPendingResource(invalidations, bridge.EvalsLocalRunResource(selectedObservedRunID), s.localRunResource)
		invalidations.Add(bridge.EvalsLocalRunResource(selectedObservedRunID), localRevision)
	} else {
		s.localRunResource.Cancel()
	}
	return invalidations
}

func (s *Evals) Refresh(ctx context.Context, client DataClient, invalidations bridge.Invalidations) tea.Cmd {
	var commands []tea.Cmd
	if revision, invalid := invalidations.Revision(bridge.EvalsCatalogResource); invalid ||
		s.catalogResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, s.fetchCatalog(ctx, client, revision))
	}
	if revision, invalid := invalidations.Revision(bridge.EvalsRunsResource); invalid ||
		s.runsResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, s.fetchRuns(ctx, client, revision))
	}
	if revision, invalid := invalidations.Revision(bridge.EvalsBaselinesResource); invalid ||
		s.baselinesResource.Snapshot().State == resource.ResourceIdle {
		commands = append(commands, s.fetchBaselines(ctx, client, revision))
	}
	if s.selectedRunID != "" {
		revision, invalid := invalidations.Revision(bridge.EvalsRunResource(s.selectedRunID))
		if wildcardRevision, wildcard := invalidations.Revision(bridge.EvalsAnyRunResource); wildcard {
			revision, invalid = maxRevisionFloor(revision, wildcardRevision), true
		}
		if invalid || s.runResource.Snapshot().Token.Owner != evalRunOwner(s.selectedRunID) {
			commands = append(commands, s.fetchSelectedRun(ctx, client, revision))
		}
	}
	if runID := s.selectedObservedRunID(); runID != "" {
		revision, invalid := invalidations.Revision(bridge.EvalsLocalRunResource(runID))
		if wildcardRevision, wildcard := invalidations.Revision(bridge.EvalsAnyLocalRunResource); wildcard {
			revision, invalid = maxRevisionFloor(revision, wildcardRevision), true
		}
		if invalid || s.localRunResource.Snapshot().Token.Owner != evalLocalRunOwner(runID) {
			commands = append(commands, s.fetchLocalRun(ctx, client, runID, revision))
		}
	}
	return tea.Batch(commands...)
}

func (s *Evals) Update(ctx context.Context, msg tea.Msg, client DataClient) tea.Cmd {
	switch message := msg.(type) {
	case evalCatalogLoadedMsg:
		if s.catalogResource.Apply(resource.ResourceResult[[]json.RawMessage](message)) {
			s.items = projectEvalCatalog(s.catalogResource.Snapshot().Value)
			s.catalog.SetItems(s.items)
			s.syncSelection()
		}
		return s.ensureSelectedRun(ctx, client)
	case evalRunsLoadedMsg:
		if s.runsResource.Apply(resource.ResourceResult[[]json.RawMessage](message)) {
			s.runs = projectEvalRuns(s.runsResource.Snapshot().Value)
			s.syncSelection()
		}
		return s.ensureSelectedRun(ctx, client)
	case evalRunLoadedMsg:
		if s.runResource.Apply(resource.ResourceResult[json.RawMessage](message)) {
			s.run, _ = projectEvalRun(s.runResource.Snapshot().Value)
			s.clampCell()
			s.syncDetail(true)
			return s.fetchSelectedLocalRun(ctx, client)
		}
	case evalBaselinesLoadedMsg:
		if s.baselinesResource.Apply(resource.ResourceResult[[]json.RawMessage](message)) {
			s.baselines = projectEvalBaselines(s.baselinesResource.Snapshot().Value)
			s.syncDetail(false)
		}
	case evalLocalRunLoadedMsg:
		if s.localRunResource.Apply(resource.ResourceResult[evalRunAvailability](message)) {
			s.syncDetail(false)
		}
	case tea.KeyPressMsg:
		command, _ := interaction.Dispatch(s.Actions(ctx, client), message)
		return command
	case tea.MouseWheelMsg:
		if s.focus == evalsFocusGrid {
			s.detail.Update(message)
		} else {
			s.catalog.Update(message)
		}
	}
	return nil
}

func (s *Evals) Counts() map[string]int { return map[string]int{"evals": len(s.items)} }

func (s *Evals) Breadcrumb() ([]string, string) {
	path := []string{"evals"}
	if selected, _, ok := s.catalog.Selected(); ok {
		path = append(path, sanitizeEvals(selected.ID))
	}
	count := len(s.items)
	return path, fmt.Sprintf("%d %s", count, kit.Pluralize(count, "eval"))
}

func (s *Evals) Keybinds() []shell.Keybind {
	return actionKeybinds(s.Actions(context.TODO(), nil), nil)
}

func (s *Evals) centerMessage(message string) string {
	return kit.PadBlock(centerMsg(s.layout.size, sanitizeEvals(message)), s.layout.size.Width, s.layout.size.Height)
}

func (s *Evals) View(_ Size) string {
	if s.layout.size.Width <= 0 || s.layout.size.Height <= 0 {
		return ""
	}
	if s.layout.mode == evalsLayoutTooSmall {
		return s.centerMessage("terminal too small — resize to at least " + evalsMinimumLabel)
	}
	snapshot := s.catalogResource.Snapshot()
	if !snapshot.HasValue {
		message := resourceStateMessage(snapshot.State, snapshot.Err, "Eval catalog")
		if snapshot.State == resource.ResourceFailed {
			message += " · press R to retry"
		}
		return s.centerMessage(message)
	}
	if len(s.items) == 0 {
		return s.centerMessage("No Evals discovered — run `crux eval`; discovery scans `.crux/evals`.")
	}
	if s.layout.mode == evalsLayoutNarrow {
		if s.focus == evalsFocusGrid {
			return strings.Join(s.renderDetailLines(s.layout.detail), "\n")
		}
		return strings.Join(s.renderListLines(s.layout.list), "\n")
	}
	rects := []kit.Rect{s.layout.list, s.layout.detail}
	return strings.Join(kit.Compose(rects, [][]string{
		s.renderListLines(rects[0]), s.renderDetailLines(rects[1]),
	}), "\n")
}
