// Package screens hosts the V1 Panels Quality workbench screens (Overview,
// Insights, Runs, Experiments, Baselines, Feedback, Cassettes, Index). Each
// screen implements the Screen interface and renders into a rectangle
// already cropped to the body area (i.e. excluding chrome, tabs, nav rail,
// breadcrumb, status bar).
package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// DataClient is the subset of the tui DataClient interface that screens use
// for in-process Quality access. Implemented by `internal/devtools.DirectClient`.
type DataClient interface {
	// Reads.
	Overview(ctx context.Context) (api.QualityOverviewRecord, error)
	Insights(ctx context.Context) ([]api.QualityInsightRecord, error)
	Runs(ctx context.Context) ([]api.QualityRunRecord, error)
	RunsWithOptions(ctx context.Context, opts api.QualityRunsOptions) ([]api.QualityRunRecord, error)
	RunDetail(ctx context.Context, traceID string) (api.QualityRunDetailRecord, bool, error)
	ObservabilityRuns(ctx context.Context) ([]api.ObservabilityRunSummary, error)
	ObservabilityRunDetail(ctx context.Context, runID string) (api.ObservabilityRunDetail, bool, error)
	ObservabilityResourceActivity(ctx context.Context, family string) ([]api.ObservabilityResourceActivity, error)
	ProjectIndex(ctx context.Context) (api.IndexData, error)
	ExperimentSummaries(ctx context.Context) ([]api.QualityExperimentSummary, error)
	ExperimentDetail(ctx context.Context, experimentID string) (api.QualityExperimentDetail, bool, error)
	PromotedBaselines(ctx context.Context) ([]api.QualityPromotedBaseline, error)
	CassetteFiles(ctx context.Context) ([]api.QualityCassetteFileRecord, error)
	ScorerStats(ctx context.Context) ([]api.QualityScorerStats, error)
	Feedback(ctx context.Context) ([]api.QualityFeedbackRecord, error)
	Activity(ctx context.Context, limit int) ([]api.QualityActivityEvent, error)
	DevtoolsContext(ctx context.Context) (api.DevtoolsContext, error)
	SubscribeQuality(ctx context.Context) <-chan api.QualityEvent
	InsightSilences(ctx context.Context, includeDeleted bool) ([]api.QualityInsightSilenceRecord, error)

	// Writes.
	SetInsightStatus(ctx context.Context, insightID string, req api.QualityInsightStatusRequest) (api.QualityInsightStatusRecord, error)
	CreateFeedbackAnnotation(ctx context.Context, req api.QualityFeedbackAnnotationPostRequest) (api.QualityFeedbackAnnotationRecord, error)
	DeleteRuns(ctx context.Context, traceIDs []string) (api.QualityDeleteRunsRecord, error)
	CreateInsightSilence(ctx context.Context, req api.QualityInsightSilenceRequest) (api.QualityInsightSilenceRecord, error)
	DeleteInsightSilence(ctx context.Context, silenceID string) (api.QualityInsightSilenceRecord, error)
	// PromoteBaseline runs the server-side promotion (the embedded
	// worker's --promote mode). Variant and pinID are optional ("" =
	// let the worker decide / refuse with its own explanatory error).
	PromoteBaseline(ctx context.Context, experimentID, variant, pinID string) (api.QualityPromoteResult, error)
}

// Size is the screen body rect.
type Size struct {
	Width  int
	Height int
}

// NavigateRequest is emitted by a screen's Update to ask the workbench
// to switch to another screen, optionally staging a record in the
// cross-screen selection store first. See ADR-0051. Workbench listens
// for this message type in its own Update and handles the routing —
// screens never call gotoNav directly.
type NavigateRequest struct {
	// NavID is the destination screen id (e.g. "insights", "runs"). The
	// screen must exist in the workbench's registry; unknown ids are
	// silently dropped.
	NavID string
	// Kind names the selection-store slot to fill before nav (e.g.
	// "insight", "run"). Empty means: no staging — just nav.
	Kind string
	// ID is the staged record id paired with Kind. Empty when Kind is
	// empty.
	ID string
}

// Screen is implemented by every Quality screen.
type Screen interface {
	// ID is the route/nav identifier (e.g. "overview", "insights").
	ID() string

	// Init is called once when the screen first becomes active. Return any
	// initial data-fetch commands.
	Init(client DataClient) tea.Cmd

	// Update handles a tea.Msg routed to this screen. Returning a non-nil cmd
	// triggers follow-up work (e.g. re-fetches after a WS event).
	Update(msg tea.Msg, client DataClient) tea.Cmd

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

	// Focus is called by the workbench before a screen becomes active when
	// the navigation that produced the activation carried a record reference
	// the screen knows how to surface. `kind` is one of the workbench Kind
	// constants ("run", "insight", "experiment", …) and `id` is the staged
	// record id. Screens MAY ignore unknown kinds. Focus is best-effort: if
	// the referenced id is not present in the screen's data, the screen
	// falls back to its own default selection. See ADR-0051.
	Focus(kind, id string)
}

// EditingScreen is an optional capability implemented by screens that own
// an embedded editor or modal widget. When `Editing()` returns true, the
// workbench forwards every key straight to the screen so editor widgets
// receive raw input. There is no global mode chip; the status bar reflects
// the screen's own Keybinds() output instead. Per ADR-0050 the TUI is
// modeless — this is a pass-through hint, not a mode.
type EditingScreen interface {
	Screen
	Editing() bool
}
