package tui

// Message types for the Bubbletea event loop.
//
// The V1 Panels Workbench owns its own screen-specific msg types (see
// screens/*.go). The messages declared here are only the ones the root App
// needs for boot orchestration and store change fan-out.

type storeChangedMsg struct{}

type bootPhaseMsg struct{ phase string }
type bootLogMsg struct {
	stream string
	text   string
}
type bootErrorMsg struct{ err string }
type liveReadyMsg struct{}
type startupSummaryMsg struct{ summary string }
type tunnelURLMsg struct{ url string }
