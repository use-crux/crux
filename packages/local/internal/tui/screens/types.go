// Package screens hosts the local inspection screens (Overview, Insights,
// Runs, and Index). Each
// screen implements the Screen interface and renders into a rectangle
// already cropped to the body area (i.e. excluding chrome, tabs, nav rail,
// breadcrumb, status bar).
package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// DataClient is the subset of the tui DataClient interface that screens use
// for in-process inspection access. Implemented by `internal/devtools.DirectClient`.
type DataClient interface {
	// Reads.
	Overview(ctx context.Context) (api.InspectOverviewRecord, error)
	Insights(ctx context.Context) ([]api.InspectInsightRecord, error)
	Runs(ctx context.Context) ([]api.InspectRunRecord, error)
	RunsWithOptions(ctx context.Context, opts api.InspectRunsOptions) ([]api.InspectRunRecord, error)
	RunDetail(ctx context.Context, traceID string) (api.InspectRunDetailRecord, bool, error)
	ObservabilityRuns(ctx context.Context) ([]api.ObservabilityRunSummary, error)
	ObservabilityRunDetail(ctx context.Context, runID string) (api.ObservabilityRunDetail, bool, error)
	ObservabilityResourceActivity(ctx context.Context, family string) ([]api.ObservabilityResourceActivity, error)
	ProjectIndex(ctx context.Context) (api.IndexData, error)
	Activity(ctx context.Context, limit int) ([]api.InspectActivityEvent, error)
	DevtoolsContext(ctx context.Context) (api.DevtoolsContext, error)
	SubscribeInspect(ctx context.Context) <-chan api.InspectEvent
	InsightSilences(ctx context.Context, includeDeleted bool) ([]api.InspectInsightSilenceRecord, error)

	// Writes.
	SetInsightStatus(ctx context.Context, insightID string, req api.InspectInsightStatusRequest) (api.InspectInsightStatusRecord, error)
	DeleteRuns(ctx context.Context, traceIDs []string) (api.InspectDeleteRunsRecord, error)
	CreateInsightSilence(ctx context.Context, req api.InspectInsightSilenceRequest) (api.InspectInsightSilenceRecord, error)
	DeleteInsightSilence(ctx context.Context, silenceID string) (api.InspectInsightSilenceRecord, error)
}

// Size is the screen body rect.
type Size struct {
	Width  int
	Height int
}

// NavigateRequest is emitted by a screen's Update to ask the workbench to
// switch to another screen. Kind and ID form an exact route parameter owned
// by the destination screen. Workbench listens for this message type and
// handles routing; screens never call navigation helpers directly.
type NavigateRequest struct {
	// NavID is the destination screen id (e.g. "insights", "runs"). The
	// screen must exist in the workbench's registry; unknown ids are
	// silently dropped.
	NavID string
	// Kind names the destination record type (e.g. "insight", "run").
	// Empty means the request changes only the screen route.
	Kind string
	// ID is the stable record identity paired with Kind. Empty when Kind is
	// empty.
	ID string
}

// Screen is implemented by every inspection screen.
type Screen interface {
	// ID is the route/nav identifier (e.g. "overview", "insights").
	ID() string

	// Init is called once when the screen first becomes active. Asynchronous
	// commands must descend from ctx.
	Init(ctx context.Context, client DataClient) tea.Cmd

	// Update handles a tea.Msg routed to this screen. Returning a non-nil cmd
	// triggers follow-up work (e.g. re-fetches after a WS event), which must
	// descend from ctx.
	Update(ctx context.Context, msg tea.Msg, client DataClient) tea.Cmd

	// View renders the screen body at the given size.
	View(size Size) string

	// Breadcrumb returns the path + right-meta for the breadcrumb row.
	Breadcrumb() (path []string, right string)

	// Keybinds returns the status-bar hints for the current screen state.
	Keybinds() []shell.Keybind

	// Counts returns nav rail counts this screen is authoritative for (e.g.
	// the Insights screen knows the insight count). Keys are nav IDs. Empty
	// map = no contribution.
	Counts() map[string]int

	// Interested reports whether a live batch touching domains should refetch
	// this screen when it is active, or mark it stale while it is hidden.
	Interested(domains bridge.Domains) bool
}

// FocusScreen is implemented by screens that can select a record reference
// carried by navigation. Screens without drill-in state omit this capability.
type FocusScreen interface {
	Screen
	Focus(kind, id string)
}

// ScreenLocation is the screen-owned portion of navigation history. It keeps
// only logical UI identity: pane focus, stable record IDs, and viewport
// anchors. Resource data remains owned by the live screen model.
type ScreenLocation struct {
	FocusedPane string
	SelectedIDs map[string]string
	Anchors     map[string]string
}

// LocationScreen is implemented by screens whose logical focus and selection
// can be restored when the user navigates Back.
type LocationScreen interface {
	Screen
	CaptureLocation() ScreenLocation
	RestoreLocation(ScreenLocation)
}

// EditingScreen is an optional capability implemented by screens that own
// an embedded editor or modal widget. When `Editing()` returns true, the
// workbench forwards every key straight to the screen so editor widgets
// receive raw input. There is no global mode chip; the status bar reflects
// the screen's own executable keybind output instead. The approved
// stabilization design keeps this pass-through contextual, not modal.
type EditingScreen interface {
	Screen
	Editing() bool
}

// ActionScreen exposes executable workflow actions in precedence order.
// Focused-pane actions, when present, precede workflow-wide actions. Actions
// that start asynchronous work must descend from the provided context.
type ActionScreen interface {
	Screen
	Actions(context.Context, DataClient) []interaction.Action
}

// LegacyKeyScreen is the temporary handled-aware adapter for workflows that
// have not migrated to ActionScreen. It prevents workspace actions from
// pre-empting keys the legacy workflow owns.
type LegacyKeyScreen interface {
	Screen
	HandlesKey(tea.KeyPressMsg) bool
}
