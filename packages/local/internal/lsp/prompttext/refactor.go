package prompttext

import (
	"math"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

const stringRefactorTitle = "Convert multiline string to `md` PromptText"

func stringRefactorAt(
	view *promptview.View,
	analysis staticprotocol.PromptTextRefactorAnalysis,
	document transient.Document,
	file string,
	requestRange protocol.Range,
) (protocol.CodeAction, bool) {
	if view == nil ||
		analysis.Status.Kind != staticprotocol.PromptTextStatusComplete ||
		compareEditorPosition(requestRange.Start, requestRange.End) > 0 {
		return protocol.CodeAction{}, false
	}
	target, ok := uniqueRefactorTarget(view, file, requestRange)
	if !ok {
		return protocol.CodeAction{}, false
	}
	proof, ok := uniqueRefactorProof(analysis.Proofs, target.Expression.Range)
	if !ok {
		return protocol.CodeAction{}, false
	}
	currentText, ok := textAtEditorRange(document.Text, target.Expression.Range)
	if !ok || currentText != proof.ExpectedText {
		return protocol.CodeAction{}, false
	}
	return protocol.CodeAction{
		Title: stringRefactorTitle,
		Kind:  protocol.CodeActionRefactorRewrite,
		Edit: &protocol.WorkspaceEdit{
			DocumentChanges: []protocol.TextDocumentEdit{{
				TextDocument: protocol.VersionedTextDocumentIdentifier{
					TextDocumentIdentifier: protocol.TextDocumentIdentifier{
						URI: document.URI,
					},
					Version: document.Version,
				},
				Edits: []protocol.TextEdit{{
					Range: target.Expression.Range,
					NewText: target.Binding.Expression +
						proof.TemplateText,
				}},
			}},
		},
	}, true
}

func uniqueRefactorTarget(
	view *promptview.View,
	file string,
	request protocol.Range,
) (promptview.StringRefactorTarget, bool) {
	var result promptview.StringRefactorTarget
	matches := 0
	for _, target := range view.RefactorTargets {
		if target.Expression.File != file ||
			!requestRangeWithinLiteral(request, target.Expression.Range) {
			continue
		}
		result = target
		matches++
	}
	return result, matches == 1
}

func requestRangeWithinLiteral(
	request protocol.Range,
	literal protocol.Range,
) bool {
	if request.Start == request.End {
		return containsPosition(literal, request.Start)
	}
	return compareEditorPosition(literal.Start, request.Start) <= 0 &&
		compareEditorPosition(request.End, literal.End) <= 0
}

func uniqueRefactorProof(
	proofs []staticprotocol.PromptTextRefactorProof,
	source protocol.Range,
) (staticprotocol.PromptTextRefactorProof, bool) {
	var result staticprotocol.PromptTextRefactorProof
	matches := 0
	for _, proof := range proofs {
		if proof.Kind != "ordinary-string-to-md" ||
			proof.Proof != staticprotocol.PromptTextRefactorProofSyntaxExact ||
			editorRange(proof.Range) != source {
			continue
		}
		result = proof
		matches++
	}
	return result, matches == 1
}

func textAtEditorRange(
	text string,
	source protocol.Range,
) (string, bool) {
	if uint64(source.Start.Line)+1 > math.MaxInt ||
		uint64(source.Start.Character)+1 > math.MaxInt ||
		uint64(source.End.Line)+1 > math.MaxInt ||
		uint64(source.End.Character)+1 > math.MaxInt {
		return "", false
	}
	_, start, startOK := sourcePosition(
		text,
		int(source.Start.Line)+1,
		int(source.Start.Character)+1,
	)
	_, end, endOK := sourcePosition(
		text,
		int(source.End.Line)+1,
		int(source.End.Character)+1,
	)
	if !startOK || !endOK || end < start {
		return "", false
	}
	return text[start:end], true
}
