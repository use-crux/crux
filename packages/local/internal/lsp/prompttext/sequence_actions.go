package prompttext

import (
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

func promptTextCodeActions(
	match diagnosticMatch,
	document transient.Document,
) []protocol.CodeAction {
	if action, ok := serializationCodeAction(match, document); ok {
		return []protocol.CodeAction{action}
	}
	if match.evidence.Cause.Kind != "inline-sequence" {
		return nil
	}

	actions := make([]protocol.CodeAction, 0, 2)
	if match.evidence.Cause.JoinableWithComma &&
		match.expressionUnique &&
		match.expressionText != "" {
		actions = append(actions, versionedPromptTextCodeAction(
			`.join(", ")`,
			match.diagnostic,
			protocol.TextEdit{
				Range: match.diagnostic.Range,
				NewText: "(" + match.expressionText +
					`).join(", ")`,
			},
			document,
		))
	}
	if match.lineIsolationEdit != nil {
		actions = append(actions, versionedPromptTextCodeAction(
			"Put sequence on its own line — changes layout",
			match.diagnostic,
			*match.lineIsolationEdit,
			document,
		))
	}
	return actions
}
