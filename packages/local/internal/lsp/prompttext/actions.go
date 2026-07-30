package prompttext

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

// ActionRequest carries only the client-echoed locator and ranges that may be
// trusted after regeneration against the embedded current Request.
type ActionRequest struct {
	Request
	DiagnosticID    string
	DiagnosticRange protocol.Range
	RequestRange    protocol.Range
}

// ActionResult is one regenerated eager action contribution. Actions retain
// their contract-defined order when independent fixes apply.
type ActionResult struct {
	Revision  transient.Revision
	ViewStamp indexview.ViewStamp
	Actions   []protocol.CodeAction
}

// Actions regenerates semantic and syntax evidence for one strict diagnostic
// locator. It never consumes the previously published PromptText lane.
func (c *Controller) Actions(
	ctx context.Context,
	request ActionRequest,
) ActionResult {
	diagnostics := c.Diagnostics(ctx, request.Request)
	empty := ActionResult{
		Revision: diagnostics.Revision, ViewStamp: diagnostics.ViewStamp,
		Actions: []protocol.CodeAction{},
	}
	if ctx.Err() != nil || !promptTextDiagnosticIDPattern.MatchString(request.DiagnosticID) {
		return empty
	}
	var match *diagnosticMatch
	for index := range diagnostics.matches {
		candidate := &diagnostics.matches[index]
		if promptTextLocatorID(candidate.diagnostic) != request.DiagnosticID {
			continue
		}
		if candidate.diagnostic.Range != request.DiagnosticRange ||
			!rangesIntersectClosed(request.RequestRange, candidate.diagnostic.Range) {
			return empty
		}
		if match != nil {
			return empty
		}
		match = candidate
	}
	if match == nil {
		return empty
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok || document.Revision != diagnostics.Revision {
		return empty
	}
	selection := currentSemanticView(request.Request, document)
	if selection.Status != indexview.ViewStatusExact || selection.View == nil ||
		selection.View.Stamp != diagnostics.ViewStamp {
		return empty
	}
	actions := promptTextCodeActions(*match, document)
	if len(actions) == 0 {
		return empty
	}
	return ActionResult{
		Revision: diagnostics.Revision, ViewStamp: diagnostics.ViewStamp,
		Actions: actions,
	}
}

// ActionResultCurrent performs the final document and complete-view-stamp
// check immediately before the server returns a regenerated action.
func (c *Controller) ActionResultCurrent(
	request Request,
	result ActionResult,
) bool {
	if c == nil || c.documents == nil {
		return false
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok || document.Revision != result.Revision {
		return false
	}
	selection := currentSemanticView(request, document)
	return selection.Status == indexview.ViewStatusExact &&
		selection.View != nil &&
		selection.View.Stamp == result.ViewStamp
}

func serializationCodeAction(
	match diagnosticMatch,
	document transient.Document,
) (protocol.CodeAction, bool) {
	if match.evidence.Cause.Kind != "invalid-interpolation" ||
		!match.evidence.Cause.MDJSONApplicable {
		return protocol.CodeAction{}, false
	}
	edit := protocol.TextEdit{
		Range: match.diagnostic.Range,
		NewText: "(" + match.tagExpression + ").json(" +
			match.expressionText + ")",
	}
	return versionedPromptTextCodeAction(
		"Serialize with `md.json()`", match.diagnostic, edit, document,
	), true
}

func versionedPromptTextCodeAction(
	title string,
	diagnostic protocol.Diagnostic,
	edit protocol.TextEdit,
	document transient.Document,
) protocol.CodeAction {
	return protocol.CodeAction{
		Title:       title,
		Kind:        protocol.CodeActionQuickFix,
		Diagnostics: []protocol.Diagnostic{diagnostic},
		Edit: &protocol.WorkspaceEdit{
			DocumentChanges: []protocol.TextDocumentEdit{{
				TextDocument: protocol.VersionedTextDocumentIdentifier{
					TextDocumentIdentifier: protocol.TextDocumentIdentifier{
						URI: document.URI,
					},
					Version: int(document.Revision.Version),
				},
				Edits: []protocol.TextEdit{edit},
			}},
		},
	}
}

func rangesIntersectClosed(left, right protocol.Range) bool {
	return compareEditorPosition(left.End, right.Start) >= 0 &&
		compareEditorPosition(right.End, left.Start) >= 0
}
