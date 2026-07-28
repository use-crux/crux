package server

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

// Close retires every PromptText transform inside the same transition
// boundary used by final language-feature validation.
func (w *workspaceRuntime) Close() {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.closed = true
	sessions := append([]*scopeSession(nil), w.sessions...)
	w.mu.Unlock()

	for _, session := range sessions {
		closeWorkspaceSession(w, session)
	}
}

func closeWorkspaceSession(w *workspaceRuntime, session *scopeSession) {
	if session == nil {
		return
	}
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()

	w.mu.Lock()
	requests := make([]*promptTextDiagnosticRequest, 0, len(session.promptTextDiagnostics))
	for _, request := range session.promptTextDiagnostics {
		requests = append(requests, request)
	}
	session.promptTextDiagnostics = nil
	session.completionFailures = 0
	views := session.promptTextViews
	cancel := session.cancel
	publisher := session.publisher
	w.mu.Unlock()

	for _, request := range requests {
		request.cancel()
	}
	if views != nil {
		views.RetireAll()
	}
	if cancel != nil {
		cancel()
	}
	if publisher != nil {
		publisher.Close()
	}
}

// restartManager preserves transition -> workspace lock ordering so a
// reconnect cannot retire transforms after a final stamp check passes.
func (w *workspaceRuntime) restartManager(session *scopeSession) {
	if session == nil {
		return
	}
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()

	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	previousMode := session.mode
	codeLensEnabled := w.settings.CodeLensEnabled
	w.mu.Unlock()

	if session.promptTextViews != nil {
		session.promptTextViews.RetireAll()
	}
	uris := w.retireOpenPromptTextDiagnostics(session)
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	session.mode = readmodel.ModeDiscovering
	session.transient = nil
	session.sourceEpoch++
	session.completionFailures = 0
	w.startManagerLocked(session)
	w.mu.Unlock()

	if w.server != nil {
		if codeLensEnabled && previousMode == readmodel.ModeAttached {
			w.server.requestCodeLensRefresh()
		}
		w.server.requestPromptTextRefresh()
		w.resumeOpenPromptTextDiagnostics(session, uris)
	}
}

// startManagerLocked establishes a manager while the caller owns w.mu. Any
// existing PromptText transform must already have been retired by the caller.
func (w *workspaceRuntime) startManagerLocked(session *scopeSession) {
	session.managerGeneration++
	generation := session.managerGeneration
	if w.ctx == nil {
		return
	}
	if session.cancel != nil {
		session.cancel()
	}
	ctx, cancel := context.WithCancel(w.ctx)
	session.cancel = cancel
	manager := readmodel.NewManager(readmodel.ManagerOptions{
		ScopeID:   session.scope.ID,
		Root:      session.scope.Root,
		Version:   w.version,
		Transport: readmodel.NewAttachTransport(api.NewDefault(w.settings.Port)),
		Store:     w.store,
		Logs:      w.logs,
		ApplyCurrent: func(apply func()) bool {
			return w.runManagerApply(session, generation, apply)
		},
		OnChange: func(change readmodel.Change) {
			w.runManagerCallback(session, generation, func() {
				w.handleScopeChangeLocked(session, change)
			})
		},
		OnIndexChange: func() {
			w.runManagerCallback(session, generation, func() {
				w.invalidateTransientSourceLocked(session)
			})
		},
		OnModeChange: func(mode readmodel.Mode) {
			w.runManagerCallback(session, generation, func() {
				w.setSessionModeLocked(session, mode)
			})
		},
		OnTransientSource: func(source readmodel.TransientSource) {
			w.runManagerCallback(session, generation, func() {
				w.setSessionTransientSourceLocked(session, source)
			})
		},
		OnWarning: func(message string) {
			w.runManagerCallback(session, generation, func() {
				w.server.Notify(ctx, protocol.MethodLogMessage, protocol.LogMessageParams{
					Type: protocol.MessageTypeWarning, Message: message,
				})
			})
		},
		OnShowWarning: func(message string) {
			w.runManagerCallback(session, generation, func() {
				w.server.Notify(ctx, protocol.MethodShowMessage, protocol.LogMessageParams{
					Type: protocol.MessageTypeWarning, Message: message,
				})
			})
		},
	})
	go manager.Run(ctx)
}

func (w *workspaceRuntime) runManagerCallback(
	session *scopeSession,
	generation uint64,
	callback func(),
) {
	w.runManagerApply(session, generation, callback)
}

func (w *workspaceRuntime) runManagerApply(
	session *scopeSession,
	generation uint64,
	apply func(),
) bool {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()

	w.mu.Lock()
	current := !w.closed && session.managerGeneration == generation
	w.mu.Unlock()
	if current {
		apply()
	}
	return current
}
