package server

import (
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttextview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func (w *workspaceRuntime) openPromptTextView(
	session *scopeSession,
	uri protocol.DocumentURI,
) {
	if session == nil {
		return
	}
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	if session.promptTextViews == nil {
		return
	}
	state, tracked := w.server.buffers.State(uri)
	file, fileOK := promptTextViewFile(uri)
	if !tracked || !fileOK {
		return
	}
	document := state.Document
	revision := promptTextViewRevision(document)
	if !state.Available {
		session.promptTextViews.Unavailable(file, revision)
		return
	}
	session.promptTextViews.Open(lsprompttextview.Request{
		ScopeID:         session.scope.ID,
		File:            file,
		Document:        &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
}

func (w *workspaceRuntime) changePromptTextView(
	session *scopeSession,
	uri protocol.DocumentURI,
	changes []protocol.TextDocumentContentChangeEvent,
) {
	if session == nil {
		return
	}
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	if session.promptTextViews == nil {
		return
	}
	file, ok := promptTextViewFile(uri)
	if !ok {
		return
	}
	state, tracked := w.server.buffers.State(uri)
	if !tracked {
		return
	}
	document := state.Document
	if !state.Available {
		session.promptTextViews.Unavailable(
			file,
			promptTextViewRevision(document),
		)
		return
	}
	session.promptTextViews.Change(
		file,
		promptTextViewRevision(document),
		changes,
	)
}

func (w *workspaceRuntime) retirePromptTextView(
	session *scopeSession,
	uri protocol.DocumentURI,
) {
	if session == nil {
		return
	}
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	if session.promptTextViews == nil {
		return
	}
	if file, ok := promptTextViewFile(uri); ok {
		session.promptTextViews.Retire(file)
	}
}

func (w *workspaceRuntime) refreshPromptTextViews(
	session *scopeSession,
	files []string,
) {
	if session.promptTextViews == nil || w.server == nil {
		return
	}
	affected := make(map[string]struct{}, len(files))
	for _, file := range files {
		if !filepath.IsAbs(file) {
			file = filepath.Join(session.scope.Root, file)
		}
		affected[filepath.Clean(file)] = struct{}{}
	}
	for _, state := range w.server.buffers.States() {
		document := state.Document
		file, ok := promptTextViewFile(document.URI)
		if !ok || !fileInScope(session.scope.Root, file) {
			continue
		}
		if len(affected) > 0 {
			if _, changed := affected[filepath.Clean(file)]; !changed {
				continue
			}
		}
		revision := promptTextViewRevision(document)
		if !state.Available {
			session.promptTextViews.Unavailable(file, revision)
			continue
		}
		session.promptTextViews.Open(lsprompttextview.Request{
			ScopeID: session.scope.ID,
			File:    file, Document: &revision,
			MinimumEvidence: indexview.EvidenceSemantic,
			Freshness:       indexview.AllowSavedFallback,
		})
	}
}

func fileInScope(root, file string) bool {
	relative, err := filepath.Rel(root, file)
	return err == nil && relative != ".." &&
		!filepath.IsAbs(relative) && !startsWithParent(relative)
}

func promptTextViewFile(uri protocol.DocumentURI) (string, bool) {
	file, err := mapping.URIToPath(string(uri))
	return file, err == nil
}

func promptTextViewRevision(document documentSnapshot) indexview.DocumentRevision {
	return indexview.DocumentRevision{
		OpenEpoch:  document.Revision.OpenEpoch,
		Version:    document.Version,
		SourceHash: document.Revision.SourceHash,
	}
}
