package tui

import tea "charm.land/bubbletea/v2"

// ShutdownCause identifies the user-visible reason the TUI requested an
// orderly shutdown.
type ShutdownCause uint8

const (
	// ShutdownClean is a normal workspace, palette, or boot-screen quit.
	ShutdownClean ShutdownCause = iota
	// ShutdownRawInterrupt is Ctrl+C received while Bubble Tea owns the raw
	// terminal. Process signals are identified by the command root instead.
	ShutdownRawInterrupt
	// ShutdownContextCanceled is cancellation requested by the command root.
	ShutdownContextCanceled
)

// ShutdownResult is the completed App-owned shutdown observed after the
// Bubble Tea program returns.
type ShutdownResult struct {
	// Cause distinguishes clean TUI completion, raw Ctrl+C, and command-root
	// cancellation.
	Cause ShutdownCause
	// Err is the cleanup callback's terminal error, if any.
	Err error
	// Completed is false when the program returned without App-owned cleanup.
	Completed bool
}

type shutdownRequestMsg struct {
	cause ShutdownCause
}

// SetShutdownCallback installs the one cleanup operation which must finish
// after Bubble Tea restores the terminal and returns from Program.Run.
func (a *App) SetShutdownCallback(fn func() error) {
	a.shutdownMu.Lock()
	defer a.shutdownMu.Unlock()
	a.shutdownCallback = fn
}

// ShutdownResult returns the result recorded by the completed shutdown.
func (a *App) ShutdownResult() ShutdownResult {
	a.shutdownMu.RLock()
	defer a.shutdownMu.RUnlock()
	return a.shutdownResult
}

func (a *App) requestShutdown(cause ShutdownCause) tea.Cmd {
	return func() tea.Msg { return shutdownRequestMsg{cause: cause} }
}

func (a *App) watchRootCancellation() tea.Cmd {
	if a.rootDone == nil {
		return nil
	}
	return func() tea.Msg {
		<-a.rootDone
		return shutdownRequestMsg{cause: ShutdownContextCanceled}
	}
}

func (a *App) beginShutdown(cause ShutdownCause) tea.Cmd {
	if !a.shutdownStarted.CompareAndSwap(false, true) {
		return nil
	}
	a.quitRequested = true
	a.shutdownMu.Lock()
	a.shutdownResult.Cause = cause
	a.shutdownMu.Unlock()

	// Cleanup can wait for an unrelated in-flight server request. Restore the
	// terminal immediately and let the command root join cleanup after Run
	// returns; otherwise the App suppresses input while keeping the user trapped
	// in the alternate screen for the entire request timeout.
	return tea.Batch(
		func() tea.Msg {
			a.FinishShutdown()
			return nil
		},
		tea.Quit,
	)
}

// FinishShutdown runs the App cleanup exactly once. It is safe to call after
// Program.Run so the terminal is already restored while server cleanup waits.
func (a *App) FinishShutdown() ShutdownResult {
	a.shutdownCleanupOnce.Do(func() {
		a.shutdownMu.RLock()
		cleanup := a.shutdownCallback
		cause := a.shutdownResult.Cause
		a.shutdownMu.RUnlock()

		var err error
		if cleanup != nil {
			err = cleanup()
		}
		a.shutdownMu.Lock()
		a.shutdownResult = ShutdownResult{Cause: cause, Err: err, Completed: true}
		a.shutdownMu.Unlock()
	})
	return a.ShutdownResult()
}
