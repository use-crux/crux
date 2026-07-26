package server

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

type workspaceController interface {
	Start(context.Context, []protocol.WorkspaceFolder, Settings)
	UpdateSettings(Settings)
	DidOpen(protocol.DocumentURI, int)
	DidChange(protocol.DocumentURI, int, []protocol.TextDocumentContentChangeEvent)
	DidSave(protocol.DocumentURI)
	DidClose(protocol.DocumentURI)
	DisplayedFindings(protocol.DocumentURI, protocol.Position) []displayedFinding
	LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool)
	Close()
}

type fixCommandWorkspace interface {
	FindingForScope(string, string) (api.IndexLintFinding, bool)
}

type fixActionWorkspace interface {
	FindingForURI(protocol.DocumentURI, string) (string, api.IndexLintFinding, bool)
}

type scopeSession struct {
	scope              readmodel.Scope
	folderName         string
	publisher          *Publisher
	views              indexview.ViewProvider
	mode               readmodel.Mode
	transient          readmodel.TransientSource
	sourceEpoch        uint64
	completionFailures int
	cancel             context.CancelFunc
}

type workspaceRuntime struct {
	server  *Server
	version string
	logs    io.Writer
	store   *readmodel.Store

	mu       sync.Mutex
	ctx      context.Context
	settings Settings
	sessions []*scopeSession
	closed   bool
}

func newWorkspaceRuntime(server *Server) *workspaceRuntime {
	return &workspaceRuntime{
		server:  server,
		version: server.options.Version,
		logs:    server.options.Logs,
		store:   readmodel.NewStore(),
	}
}

func (w *workspaceRuntime) Start(ctx context.Context, folders []protocol.WorkspaceFolder, settings Settings) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed || w.ctx != nil {
		return
	}
	w.ctx = ctx
	w.settings = settings
	for _, scope := range readmodel.DetectScopes(folders) {
		lines := mapping.NewLineIndex()
		session := &scopeSession{
			scope: scope, folderName: workspaceFolderName(scope.Root, folders),
			views: indexview.NewSavedProvider(w.store),
		}
		session.publisher = NewPublisher(PublisherOptions{
			ScopeID:    scope.ID,
			Root:       scope.Root,
			ConfigFile: scope.ConfigFile,
			Store:      w.store,
			Lines:      lines,
			Notify: func(method string, params any) {
				w.server.Notify(ctx, method, params)
			},
			OnPublish: w.server.requestEditorAnnotationsRefreshIfEnabled,
			Log: func(message string) {
				fmt.Fprintf(w.logs, "crux lsp: %s\n", message)
			},
			Trace: func(message string) {
				w.server.traceMessage(ctx, message)
			},
		})
		session.publisher.UpdateFilter(mapping.FilterOptions{
			Profile:           settings.Profile,
			IncludeSuppressed: settings.IncludeSuppressed,
		})
		w.sessions = append(w.sessions, session)
		w.startManagerLocked(session)
	}
}

func (w *workspaceRuntime) UpdateSettings(settings Settings) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	portChanged := w.settings.Port != settings.Port
	w.settings = settings
	filter := mapping.FilterOptions{
		Profile:           settings.Profile,
		IncludeSuppressed: settings.IncludeSuppressed,
	}
	for _, session := range w.sessions {
		session.publisher.UpdateFilter(filter)
		if portChanged {
			w.startManagerLocked(session)
		}
	}
}

func (w *workspaceRuntime) DidOpen(uri protocol.DocumentURI, version int) {
	for _, session := range w.sessionsForURI(uri) {
		session.publisher.DidOpen(uri, version)
	}
}

func (w *workspaceRuntime) DidChange(uri protocol.DocumentURI, version int, changes []protocol.TextDocumentContentChangeEvent) {
	for _, session := range w.sessionsForURI(uri) {
		session.publisher.DidChange(uri, version, changes)
	}
}

func (w *workspaceRuntime) DidSave(uri protocol.DocumentURI) {
	for _, session := range w.sessionsForURI(uri) {
		session.publisher.DidSave(uri)
	}
}

func (w *workspaceRuntime) DidClose(uri protocol.DocumentURI) {
	for _, session := range w.sessionsForURI(uri) {
		w.resetCompletionFailures(session)
		session.publisher.DidClose(uri)
	}
}

func (w *workspaceRuntime) DisplayedFindings(uri protocol.DocumentURI, position protocol.Position) []displayedFinding {
	for _, session := range w.sessionsForURI(uri) {
		if findings := session.publisher.DisplayedFindings(uri, position); len(findings) > 0 {
			return findings
		}
	}
	return nil
}

func (w *workspaceRuntime) LeadingWhitespace(uri protocol.DocumentURI, line uint32) (string, bool) {
	sessions := w.sessionsForURI(uri)
	if len(sessions) == 0 {
		return "", false
	}
	return sessions[0].publisher.LeadingWhitespace(uri, line), true
}

func (w *workspaceRuntime) FindingForScope(root, id string) (api.IndexLintFinding, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, session := range w.sessions {
		if session.scope.Root == root {
			return w.store.Finding(session.scope.ID, id)
		}
	}
	return api.IndexLintFinding{}, false
}

func (w *workspaceRuntime) FindingForURI(uri protocol.DocumentURI, id string) (string, api.IndexLintFinding, bool) {
	sessions := w.sessionsForURI(uri)
	if len(sessions) == 0 {
		return "", api.IndexLintFinding{}, false
	}
	session := sessions[0]
	finding, ok := w.store.Finding(session.scope.ID, id)
	return session.scope.Root, finding, ok
}

func (w *workspaceRuntime) Close() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return
	}
	w.closed = true
	for _, session := range w.sessions {
		session.completionFailures = 0
		if session.cancel != nil {
			session.cancel()
		}
		session.publisher.Close()
	}
}

func (w *workspaceRuntime) startManagerLocked(session *scopeSession) {
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
		OnChange: func(change readmodel.Change) {
			w.handleScopeChange(session, change)
		},
		OnIndexChange: func() {
			w.invalidateTransientSource(session)
		},
		OnModeChange: func(mode readmodel.Mode) {
			w.setSessionMode(session, mode)
		},
		OnTransientSource: func(source readmodel.TransientSource) {
			w.setSessionTransientSource(session, source)
		},
		OnWarning: func(message string) {
			w.server.Notify(ctx, protocol.MethodLogMessage, protocol.LogMessageParams{
				Type: protocol.MessageTypeWarning, Message: message,
			})
		},
		OnShowWarning: func(message string) {
			w.server.Notify(ctx, protocol.MethodShowMessage, protocol.LogMessageParams{
				Type: protocol.MessageTypeWarning, Message: message,
			})
		},
	})
	go manager.Run(ctx)
}

func (w *workspaceRuntime) sessionsForURI(uri protocol.DocumentURI) []*scopeSession {
	path, err := mapping.URIToPath(string(uri))
	if err != nil {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	result := make([]*scopeSession, 0, 1)
	for _, session := range w.sessions {
		relative, err := filepath.Rel(session.scope.Root, path)
		if err == nil && relative != ".." && !filepath.IsAbs(relative) && !startsWithParent(relative) {
			result = append(result, session)
		}
	}
	return result
}

func startsWithParent(path string) bool {
	return len(path) > 3 && path[:3] == ".."+string(filepath.Separator)
}
