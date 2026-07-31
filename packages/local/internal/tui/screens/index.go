package screens

import (
	"context"
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

// Index is the Project Index screen: the design-plane sibling of
// the runtime Run list. Each row is a ProjectDefinition (prompt /
// context / tool / agent / flow / composition / scorer / eval / …)
// surfaced from the Go service's index read-model.
//
// Per the backend handoff, the TUI is purely presentational:
//   - reads `c.ProjectIndex(ctx)` for the canonical view
//   - does NOT walk relations or compute fingerprints client-side
//   - missing Inspect renders as no signal, not as an error
type Index struct {
	snapshot                      *resource.Resource[api.IndexData]
	watch                         *resource.Resource[api.ProjectIndexWatchStatus]
	activity                      *resource.Resource[api.CatalogRuntimeActivityV1]
	definitions                   *kit.ListPane[api.ProjectDefinition]
	detail                        *kit.DocumentPane
	focus                         indexFocus
	groupAxis                     indexGroupAxis
	showSuppressed                bool
	relationCursor                int
	size                          Size
	layout                        indexLayout
	exportRoot                    func() (string, error)
	exportState                   indexExportState
	routedDefinitionID            string
	routedDefinitionAnchorPending bool
	unavailableDefinitionID       string
}

// NewIndex constructs an empty Index screen.
func NewIndex() *Index {
	definitions := kit.NewListPane(func(definition api.ProjectDefinition) string {
		return definition.ID
	})
	index := &Index{
		snapshot: resource.New(func(index api.IndexData) bool {
			return len(index.Definitions) == 0
		}),
		watch: resource.New(func(status api.ProjectIndexWatchStatus) bool {
			return status.State == ""
		}),
		activity: resource.New(func(activity api.CatalogRuntimeActivityV1) bool {
			return activity.DefinitionID == ""
		}),
		definitions: definitions,
		detail:      kit.NewDocumentPane(),
		exportRoot:  defaultIndexExportRoot,
	}
	definitions.SetRowHeight(index.definitionRowHeight)
	index.setFocus(indexFocusDefinitions)
	return index
}

// SetIndexForTest is a test-only seed used by workbench integration
// tests to inject a index snapshot without going through Init's
// async fetch. It seeds the same owned resource used by production fetches.
func (s *Index) SetIndexForTest(data api.IndexData) {
	_, token := s.snapshot.Begin(context.TODO(), indexSnapshotOwner, 0)
	s.applyIndexResult(resource.ResourceResult[api.IndexData]{Token: token, Value: data})
}

func (s *Index) ID() string { return "index" }

// Focus selects the exact Project Index identity carried by a navigation
// target. Display names never participate in route resolution.
func (s *Index) Focus(kind, id string) {
	if kind != "definition" || id == "" {
		return
	}
	if id != s.SelectedDefinitionID() {
		s.relationCursor = 0
	}
	s.routedDefinitionID = id
	s.routedDefinitionAnchorPending = true
	s.resolveRoutedDefinition()
}

// FocusRoot leaves the current list selection intact while clearing an exact
// route miss that would otherwise obscure the root Project Index browser.
func (s *Index) FocusRoot() {
	s.routedDefinitionID = ""
	s.routedDefinitionAnchorPending = false
	s.unavailableDefinitionID = ""
	s.syncDetail()
}

func (s *Index) Init(ctx context.Context, c DataClient) tea.Cmd {
	return s.fetchIndex(ctx, c)
}

// Deactivate cancels an in-flight snapshot and returns its exact retry name.
func (s *Index) Deactivate() bridge.Invalidations {
	invalidations := bridge.Invalidations{}
	cancelPendingResource(invalidations, bridge.IndexSnapshotResource, s.snapshot)
	s.watch.Cancel()
	s.activity.Cancel()
	return invalidations
}

// Refresh schedules the Project Index snapshot once when it is invalidated or
// has not yet been loaded.
func (s *Index) Refresh(ctx context.Context, c DataClient, invalidations bridge.Invalidations) tea.Cmd {
	revision, invalid := invalidations.Revision(bridge.IndexSnapshotResource)
	if invalid || s.snapshot.Snapshot().State == resource.ResourceIdle {
		return s.fetchIndexAtRevision(ctx, c, revision)
	}
	selectedID := s.SelectedDefinitionID()
	if s.routedDefinitionID != "" && selectedID != "" &&
		s.activity.Snapshot().Token.Owner != indexActivityOwnerForDefinition(selectedID) {
		return s.fetchDefinitionActivity(ctx, c)
	}
	return nil
}

func (s *Index) Counts() map[string]int {
	return map[string]int{"index": len(s.indexData().Definitions)}
}

func (s *Index) Update(ctx context.Context, msg tea.Msg, c DataClient) tea.Cmd {
	switch m := msg.(type) {
	case indexLoadedMsg:
		s.applyIndexResult(resource.ResourceResult[api.IndexData](m))
		return tea.Batch(s.fetchDefinitionActivity(ctx, c), s.fetchWatchStatus(ctx, c))
	case indexWatchLoadedMsg:
		s.watch.Apply(resource.ResourceResult[api.ProjectIndexWatchStatus](m))
		s.syncDetail()
	case indexActivityLoadedMsg:
		if s.activity.Apply(resource.ResourceResult[api.CatalogRuntimeActivityV1](m)) {
			s.syncDetail()
		}
	case tea.KeyPressMsg:
		cmd, _ := interaction.Dispatch(s.Actions(ctx, c), m)
		return cmd
	case tea.MouseWheelMsg:
		s.updateFocusedPane(m)
	case definitionExportedMsg:
		if m.err != nil {
			s.exportState = indexExportState{definitionID: m.defID, message: "export failed · " + sanitizeIndexInline(m.err.Error())}
		} else {
			s.exportState = indexExportState{definitionID: m.defID, message: "exported " + sanitizeIndexInline(m.filename)}
		}
	}
	return nil
}

func (s *Index) applyIndexResult(result resource.ResourceResult[api.IndexData]) {
	if s.snapshot.Apply(result) {
		s.definitions.SetItems(s.groupedDefinitions())
		if s.routedDefinitionID != "" {
			s.resolveRoutedDefinition()
		} else {
			s.syncDetail()
		}
	}
}

func (s *Index) resolveRoutedDefinition() {
	if s.routedDefinitionID == "" {
		return
	}
	if s.definitions.Select(s.routedDefinitionID) {
		s.unavailableDefinitionID = ""
		document := s.syncDetail()
		if s.routedDefinitionAnchorPending {
			s.setFocus(indexFocusDetail)
			if document.hasSourceLocation {
				s.detail.RestoreAnchor(document.sourceLocationAnchor)
			}
			s.routedDefinitionAnchorPending = false
		}
		return
	}
	s.routedDefinitionAnchorPending = true
	s.unavailableDefinitionID = s.routedDefinitionID
	s.detail.SetContent("", "")
}

func (s *Index) indexData() api.IndexData {
	return s.snapshot.Snapshot().Value
}

// SelectedDefinitionID returns the id of the cursor-focused definition.
func (s *Index) SelectedDefinitionID() string {
	if s.unavailableDefinitionID != "" {
		return ""
	}
	definition, _, ok := s.definitions.Selected()
	if !ok {
		return ""
	}
	return definition.ID
}

func (s *Index) selectedDefinition() (api.ProjectDefinition, bool) {
	definition, _, ok := s.definitions.Selected()
	return definition, ok
}

func (s *Index) Breadcrumb() ([]string, string) {
	path := []string{"index"}
	if id := firstNonEmpty(s.unavailableDefinitionID, s.SelectedDefinitionID()); id != "" {
		path = append(path, sanitizeIndexInline(id))
	}
	count := len(s.indexData().Definitions)
	right := fmt.Sprintf("%d %s", count, kit.Pluralize(count, "definition"))
	return path, right
}

func (s *Index) View(_ Size) string {
	if s.layout.size.Width <= 0 || s.layout.size.Height <= 0 {
		return ""
	}
	if s.layout.mode == indexLayoutTooSmall {
		return s.centerMessage("terminal too small — resize to at least " + indexMinimumLabel)
	}
	snapshot := s.snapshot.Snapshot()
	if !snapshot.HasValue {
		return s.centerMessage(resourceStateMessage(snapshot.State, snapshot.Err, "project index"))
	}
	if s.unavailableDefinitionID != "" {
		return s.centerMessage("definition " + sanitizeIndexInline(s.unavailableDefinitionID) + " not in current index")
	}
	if len(snapshot.Value.Definitions) == 0 {
		message := "No definitions yet — add a Crux definition, then run `crux dev`."
		if snapshot.State == resource.ResourceDegraded {
			message = "degraded project index"
			if snapshot.Err != nil {
				message += ": " + snapshot.Err.Error()
			}
			message += " · no project definitions"
		} else if snapshot.Refreshing {
			message = "refreshing project index · " + message
		}
		return s.centerMessage(message)
	}
	if s.layout.mode == indexLayoutNarrow {
		if s.focus == indexFocusDetail {
			return strings.Join(s.renderDetailLines(s.layout.detail), "\n")
		}
		return strings.Join(s.renderListLines(s.layout.list), "\n")
	}
	panes := []kit.Rect{s.layout.list, s.layout.detail}
	return strings.Join(kit.Compose(panes, [][]string{
		s.renderListLines(panes[0]),
		s.renderDetailLines(panes[1]),
	}), "\n")
}

func (s *Index) centerMessage(message string) string {
	return kit.PadBlock(centerMsg(s.layout.size, sanitizeIndexInline(message)), s.layout.size.Width, s.layout.size.Height)
}
