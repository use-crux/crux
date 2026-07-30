package server

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

type promptTextActionLocator struct {
	ID              string
	DiagnosticRange protocol.Range
	RequestRange    protocol.Range
}

type promptTextActionWorkspace interface {
	PromptTextActions(
		context.Context,
		protocol.DocumentURI,
		[]promptTextActionLocator,
	) lsprompttext.ActionResult
}

func (w *workspaceRuntime) PromptTextActions(
	ctx context.Context,
	uri protocol.DocumentURI,
	locators []promptTextActionLocator,
) lsprompttext.ActionResult {
	return w.promptTextActions(ctx, uri, locators, nil)
}

func (w *workspaceRuntime) promptTextActions(
	ctx context.Context,
	uri protocol.DocumentURI,
	locators []promptTextActionLocator,
	afterLocator func(int),
) lsprompttext.ActionResult {
	session := w.navigationSession(uri)
	if session == nil || len(locators) == 0 {
		return emptyPromptTextActionResult()
	}
	document, ok := w.server.buffers.Snapshot(uri)
	if !ok {
		return emptyPromptTextActionResult()
	}
	w.mu.Lock()
	pending := session.promptTextDiagnostics[uri]
	if w.closed || pending == nil ||
		(session.mode != readmodel.ModeOwn &&
			session.mode != readmodel.ModeAttached) ||
		session.transient == nil {
		w.mu.Unlock()
		return emptyPromptTextActionResult()
	}
	source := session.transient
	sourceEpoch := session.sourceEpoch
	views := session.views
	scope := session.scope
	generation := pending.generation
	w.mu.Unlock()
	file, err := mapping.URIToPath(string(uri))
	if err != nil {
		return emptyPromptTextActionResult()
	}
	request := lsprompttext.Request{
		URI: uri, File: file, Root: scope.Root, ScopeID: scope.ID,
		SourceEpoch: sourceEpoch, Analyzer: source, Views: views,
	}
	result := lsprompttext.ActionResult{
		Revision: document.Revision,
		Actions:  []protocol.CodeAction{},
	}
	for index, locator := range locators {
		contribution := w.server.promptText.Actions(
			ctx,
			lsprompttext.ActionRequest{
				Request:         request,
				DiagnosticID:    locator.ID,
				DiagnosticRange: locator.DiagnosticRange,
				RequestRange:    locator.RequestRange,
			},
		)
		if len(contribution.Actions) > 0 {
			if len(result.Actions) > 0 &&
				(result.Revision != contribution.Revision ||
					result.ViewStamp != contribution.ViewStamp) {
				return emptyPromptTextActionResult()
			}
			result.Revision = contribution.Revision
			result.ViewStamp = contribution.ViewStamp
			result.Actions = append(result.Actions, contribution.Actions...)
		}
		if afterLocator != nil {
			afterLocator(index)
		}
	}
	if len(result.Actions) == 0 {
		return emptyPromptTextActionResult()
	}
	session.promptTextTransition.Lock()
	defer session.promptTextTransition.Unlock()
	currentDocument, currentOK := w.server.buffers.Snapshot(uri)
	w.mu.Lock()
	currentPending := session.promptTextDiagnostics[uri]
	retiredView, retired := session.promptTextRetiredViews[uri]
	current := !w.closed && currentOK &&
		currentDocument.Revision == document.Revision &&
		currentPending != nil &&
		currentPending.generation == generation &&
		session.sourceEpoch == sourceEpoch &&
		session.transient != nil &&
		(session.mode == readmodel.ModeOwn ||
			session.mode == readmodel.ModeAttached)
	w.mu.Unlock()
	if !current || ctx.Err() != nil ||
		retired && retiredView == result.ViewStamp ||
		!w.server.promptText.ActionResultCurrent(request, result) {
		return emptyPromptTextActionResult()
	}
	return result
}

func emptyPromptTextActionResult() lsprompttext.ActionResult {
	return lsprompttext.ActionResult{Actions: []protocol.CodeAction{}}
}
