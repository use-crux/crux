package prompttext

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptTextJoinActionCopiesExactAuthoredExpressionOnce(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		expression string
		want       string
	}{
		{
			name:       "comments and wrappers",
			expression: "items /* once */ satisfies readonly string[]",
			want:       `(items /* once */ satisfies readonly string[]).join(", ")`,
		},
		{
			name:       "existing parentheses remain",
			expression: "(items)",
			want:       `((items)).join(", ")`,
		},
		{
			name:       "multiline CRLF and Unicode",
			expression: "(\r\n\titems /* 🦀 */\r\n)",
			want:       "((\r\n\titems /* 🦀 */\r\n)).join(\", \")",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			actions := promptTextCodeActions(diagnosticMatch{
				diagnostic: protocol.Diagnostic{
					Range: protocol.Range{
						End: protocol.Position{Character: 1},
					},
				},
				evidence: store.PromptTextDiagnosticEvidence{
					Cause: store.PromptTextDiagnosticCause{
						Kind:              "inline-sequence",
						JoinableWithComma: true,
					},
				},
				expressionText:   test.expression,
				expressionUnique: true,
			}, transient.Document{
				URI: "file:///repo/source.ts",
				Revision: transient.Revision{
					OpenEpoch:  1,
					Version:    2,
					SourceHash: "hash",
				},
			})
			if len(actions) != 1 {
				t.Fatalf("actions = %#v, want join", actions)
			}
			edit := actions[0].Edit.DocumentChanges[0].Edits[0]
			if edit.NewText != test.want {
				t.Fatalf("join edit = %q, want %q", edit.NewText, test.want)
			}
		})
	}
}

func TestPromptTextJoinActionRequiresPositiveUniqueEvidence(t *testing.T) {
	t.Parallel()

	for _, match := range []diagnosticMatch{
		{
			evidence: store.PromptTextDiagnosticEvidence{
				Cause: store.PromptTextDiagnosticCause{
					Kind: "inline-sequence",
				},
			},
			expressionText:   "items",
			expressionUnique: true,
		},
		{
			evidence: store.PromptTextDiagnosticEvidence{
				Cause: store.PromptTextDiagnosticCause{
					Kind:              "inline-sequence",
					JoinableWithComma: true,
				},
			},
			expressionText: "items",
		},
	} {
		if actions := promptTextCodeActions(
			match,
			transient.Document{},
		); len(actions) != 0 {
			t.Fatalf("insufficient join evidence produced %#v", actions)
		}
	}
}
