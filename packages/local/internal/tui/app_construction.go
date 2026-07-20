package tui

import (
	"context"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// NewApp creates the root TUI model. Workbench commands inherit ctx so
// cancellation at the command root reaches in-flight screen work.
func NewApp(ctx context.Context, serverURL string, client DataClient, startupMode string, startupDebug bool) *App {
	loading := spinner.New(spinner.WithSpinner(spinner.MiniDot))
	loading.Style = lipgloss.NewStyle().Foreground(accent)
	app := &App{
		client:         client,
		serverURL:      serverURL,
		spinner:        loading,
		pendingMsgs:    make(chan tea.Msg, 256),
		programStarted: make(chan struct{}),
		bootPhase:      bootPhaseOrder[0],
		startupMode:    startupMode,
		startupDebug:   startupDebug,
		rootDone:       ctx.Done(),
	}
	app.workbench = NewWorkbench(ctx, client, client, serverURL)
	app.workbench.setShutdownRequest(func() tea.Cmd { return app.requestShutdown(ShutdownClean) })
	return app
}
