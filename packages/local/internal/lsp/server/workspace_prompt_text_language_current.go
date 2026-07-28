package server

import (
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

// promptTextLanguageResultCurrent serializes the response-bound validation
// with publication and transient-source handovers. A result can leave this
// boundary only while its document, source epoch, and complete transformed
// view stamp still identify the session's current authorities.
func (w *workspaceRuntime) promptTextLanguageResultCurrent(
	session *scopeSession,
	uri protocol.DocumentURI,
	sourceEpoch uint64,
	views *promptview.LiveProvider,
	revision transient.Revision,
	stamp promptview.Stamp,
	contributingFiles []string,
	documents []promptview.DocumentStamp,
) bool {
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()

	document, available := w.server.buffers.Snapshot(uri)
	w.mu.Lock()
	current := !w.closed && available &&
		document.Revision == revision &&
		(session.mode == readmodel.ModeOwn ||
			session.mode == readmodel.ModeAttached) &&
		session.sourceEpoch == sourceEpoch &&
		session.transient != nil &&
		session.promptTextViews == views
	w.mu.Unlock()
	return current &&
		views != nil &&
		w.promptTextDocumentStampsCurrent(
			session,
			stamp.TransformRevision,
			contributingFiles,
			documents,
		) &&
		views.Current(stamp)
}

func (w *workspaceRuntime) promptTextDocumentStampsCurrent(
	session *scopeSession,
	transformRevision uint64,
	contributingFiles []string,
	documents []promptview.DocumentStamp,
) bool {
	if w == nil || w.server == nil || session == nil {
		return false
	}
	expectedFiles := make(map[string]struct{}, len(contributingFiles))
	for _, file := range contributingFiles {
		if file == "" {
			return false
		}
		if _, duplicate := expectedFiles[file]; duplicate {
			return false
		}
		expectedFiles[file] = struct{}{}
	}
	openByFile := make(map[string]promptview.DocumentStamp, len(documents))
	for _, expected := range documents {
		if expected.TransformRevision != transformRevision {
			return false
		}
		if _, contributes := expectedFiles[expected.File]; !contributes {
			return false
		}
		if _, duplicate := openByFile[expected.File]; duplicate {
			return false
		}
		openByFile[expected.File] = expected
	}
	for _, file := range contributingFiles {
		uri := protocol.DocumentURI(mapping.FileURI(session.scope.Root, file))
		state, tracked := w.server.buffers.State(uri)
		expected, wasOpen := openByFile[file]
		if wasOpen {
			if !tracked ||
				promptTextViewRevision(state.Document) != expected.Revision {
				return false
			}
			continue
		}
		if tracked {
			return false
		}
	}
	return true
}
