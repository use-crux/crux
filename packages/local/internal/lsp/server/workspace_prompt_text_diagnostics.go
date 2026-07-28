package server

import (
	"context"
	"path/filepath"
	"sort"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

const promptTextDiagnosticDeadline = 2 * time.Second

type promptTextDiagnosticRequest struct {
	generation uint64
	cancel     context.CancelFunc
}

func (w *workspaceRuntime) resetPromptTextDiagnostics(
	session *scopeSession,
	uri protocol.DocumentURI,
	schedule bool,
) {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	w.replacePromptTextDiagnostics(session, uri, schedule, true)
}

func (w *workspaceRuntime) replacePromptTextDiagnostics(
	session *scopeSession,
	uri protocol.DocumentURI,
	schedule bool,
	clear bool,
) {
	if w == nil || w.server == nil || w.server.diagnostics == nil {
		return
	}
	if clear {
		// Every identity invalidation retires in-flight PromptText feature
		// requests as well as the diagnostic lane. Internal retirement uses a
		// distinct cancellation cause, so code actions return an empty
		// contribution while explicit client cancellation remains -32800.
		w.server.cancelDocumentPromptText(uri)
	}
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	if session.promptTextDiagnostics == nil {
		session.promptTextDiagnostics = make(
			map[protocol.DocumentURI]*promptTextDiagnosticRequest,
		)
	}
	if clear {
		delete(session.promptTextAcceptedViews, uri)
	}
	previous := session.promptTextDiagnostics[uri]
	if !schedule {
		delete(session.promptTextDiagnostics, uri)
		w.mu.Unlock()
		if previous != nil {
			previous.cancel()
		}
		w.server.diagnostics.ClearPromptText(uri)
		return
	}
	generation := uint64(1)
	if previous != nil {
		generation = previous.generation + 1
	}
	parent := w.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	current := &promptTextDiagnosticRequest{
		generation: generation, cancel: cancel,
	}
	session.promptTextDiagnostics[uri] = current
	mode := session.mode
	source := session.transient
	sourceEpoch := session.sourceEpoch
	views := session.views
	scope := session.scope
	w.mu.Unlock()

	if previous != nil {
		previous.cancel()
	}
	if clear {
		w.server.diagnostics.ClearPromptText(uri)
	}
	if !w.server.promptTextDiagnosticsEnabled() ||
		source == nil ||
		(mode != readmodel.ModeOwn && mode != readmodel.ModeAttached) {
		return
	}
	file, err := mapping.URIToPath(string(uri))
	if err != nil {
		return
	}
	go w.runPromptTextDiagnostics(
		ctx,
		session,
		current,
		lsprompttext.Request{
			URI: uri, File: file, Root: scope.Root, ScopeID: scope.ID,
			SourceEpoch: sourceEpoch, Analyzer: source, Views: views,
		},
		sourceEpoch,
	)
}

func (w *workspaceRuntime) retireOpenPromptTextDiagnostics(
	session *scopeSession,
) []protocol.DocumentURI {
	if session == nil || session.publisher == nil {
		return nil
	}
	views := session.publisher.openDocumentViews()
	uris := make([]protocol.DocumentURI, 0, len(views))
	for uri := range views {
		uris = append(uris, uri)
	}
	sort.Slice(uris, func(left, right int) bool {
		return uris[left] < uris[right]
	})
	for _, uri := range uris {
		w.replacePromptTextDiagnostics(session, uri, false, true)
	}
	return uris
}

func (w *workspaceRuntime) resumeOpenPromptTextDiagnostics(
	session *scopeSession,
	uris []protocol.DocumentURI,
) {
	for _, uri := range uris {
		w.replacePromptTextDiagnostics(session, uri, true, false)
	}
}

func (w *workspaceRuntime) runPromptTextDiagnostics(
	parent context.Context,
	session *scopeSession,
	pending *promptTextDiagnosticRequest,
	request lsprompttext.Request,
	sourceEpoch uint64,
) {
	ctx, cancel := context.WithTimeout(parent, promptTextDiagnosticDeadline)
	defer cancel()
	result := w.server.promptText.Diagnostics(ctx, request)
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	if ctx.Err() != nil ||
		!w.currentPromptTextDiagnosticRequest(
			session, request.URI, pending, sourceEpoch,
		) ||
		!w.server.promptText.DiagnosticResultCurrent(request, result) ||
		!w.acceptPromptTextDiagnosticView(
			session,
			request.URI,
			result.ViewStamp,
		) {
		return
	}
	w.server.diagnostics.SubmitPromptText(
		request.URI,
		promptTextDiagnosticStamp{
			Revision: result.Revision, SourceEpoch: sourceEpoch,
			ViewStamp:         result.ViewStamp,
			RequestGeneration: pending.generation,
		},
		result.Diagnostics,
	)
}

func (w *workspaceRuntime) acceptPromptTextDiagnosticView(
	session *scopeSession,
	uri protocol.DocumentURI,
	stamp indexview.ViewStamp,
) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	retired, blocked := session.promptTextRetiredViews[uri]
	if blocked && retired == stamp {
		return false
	}
	if blocked {
		delete(session.promptTextRetiredViews, uri)
	}
	if session.promptTextAcceptedViews == nil {
		session.promptTextAcceptedViews = make(
			map[protocol.DocumentURI]indexview.ViewStamp,
		)
	}
	session.promptTextAcceptedViews[uri] = stamp
	return true
}

func (w *workspaceRuntime) currentPromptTextDiagnosticRequest(
	session *scopeSession,
	uri protocol.DocumentURI,
	pending *promptTextDiagnosticRequest,
	sourceEpoch uint64,
) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return !w.closed &&
		session.promptTextDiagnostics[uri] == pending &&
		session.sourceEpoch == sourceEpoch &&
		(session.mode == readmodel.ModeOwn ||
			session.mode == readmodel.ModeAttached) &&
		session.transient != nil
}

func (w *workspaceRuntime) resetOpenPromptTextDiagnostics(
	session *scopeSession,
	files []string,
) {
	if session == nil || session.publisher == nil {
		return
	}
	views := session.publisher.openDocumentViews()
	for uri := range views {
		if len(files) > 0 &&
			!documentURIInChangedFiles(uri, session.scope.Root, files) {
			continue
		}
		w.replacePromptTextDiagnostics(session, uri, true, true)
	}
}

func documentURIInChangedFiles(
	uri protocol.DocumentURI,
	root string,
	files []string,
) bool {
	document, err := mapping.URIToPath(string(uri))
	if err != nil {
		return false
	}
	document = filepath.Clean(document)
	for _, file := range files {
		if !filepath.IsAbs(file) {
			file = filepath.Join(root, file)
		}
		if filepath.Clean(file) == document {
			return true
		}
	}
	return false
}

func (s *Server) promptTextDiagnosticsEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.diagnosticVersionSupport
}
