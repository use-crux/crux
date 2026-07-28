package prompttext

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextSequenceDiagnosticOffersJoinThenProvenLayout(t *testing.T) {
	t.Parallel()

	fixture := promptTextSequenceFixture(t)
	controller := NewController(&fixedDocumentSource{document: fixture.document})
	diagnostics := controller.Diagnostics(context.Background(), fixture.request)
	if len(diagnostics.Diagnostics) != 1 ||
		diagnostics.Diagnostics[0].Code != "CRUX_PROMPT_TEXT_INLINE_SEQUENCE" ||
		diagnostics.Diagnostics[0].Message != fixture.message {
		t.Fatalf("sequence diagnostics = %#v, want exact explanation", diagnostics)
	}
	result := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	if len(result.Actions) != 2 {
		t.Fatalf("sequence actions = %#v, want join and layout", result.Actions)
	}
	assertSequenceAction(
		t,
		result.Actions[0],
		`.join(", ")`,
		fixture.expressionRange,
		`(items /* once */).join(", ")`,
	)
	assertSequenceAction(
		t,
		result.Actions[1],
		"Put sequence on its own line — changes layout",
		fixture.layoutRange,
		"\n${items /* once */}\n",
	)
}

func TestPromptTextSequenceActionsRequireIndependentProofs(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name            string
		joinable        bool
		lineIsolation   bool
		wantActionTitle string
	}{
		{
			name:          "layout only without joinability",
			lineIsolation: true, wantActionTitle: "Put sequence on its own line — changes layout",
		},
		{
			name:     "join only without layout proof",
			joinable: true, wantActionTitle: `.join(", ")`,
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			fixture := promptTextSequenceFixture(t)
			fixture.setJoinable(t, test.joinable)
			if !test.lineIsolation {
				fixture.analysis.Templates[0].InterpolationBarriers[0].
					LineIsolationEdit = nil
				fixture.request.Analyzer = fixedTransientSource{
					result: fixture.analysis,
				}
			}
			controller := NewController(
				&fixedDocumentSource{document: fixture.document},
			)
			result := controller.Actions(context.Background(), ActionRequest{
				Request: fixture.request, DiagnosticID: fixture.diagnosticID,
				DiagnosticRange: fixture.expressionRange,
				RequestRange:    fixture.expressionRange,
			})
			if len(result.Actions) != 1 ||
				result.Actions[0].Title != test.wantActionTitle {
				t.Fatalf("actions = %#v, want %q", result.Actions, test.wantActionTitle)
			}
		})
	}
}

func TestPromptTextLayoutActionRejectsExpectedTextMismatch(t *testing.T) {
	t.Parallel()

	fixture := promptTextSequenceFixture(t)
	fixture.analysis.Templates[0].InterpolationBarriers[0].
		LineIsolationEdit.ExpectedText = "forged"
	fixture.request.Analyzer = fixedTransientSource{result: fixture.analysis}
	controller := NewController(&fixedDocumentSource{document: fixture.document})
	result := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	if len(result.Actions) != 1 || result.Actions[0].Title != `.join(", ")` {
		t.Fatalf("mismatched proof actions = %#v, want join only", result.Actions)
	}
}

func assertSequenceAction(
	t *testing.T,
	action protocol.CodeAction,
	title string,
	editRange protocol.Range,
	newText string,
) {
	t.Helper()
	if action.Title != title ||
		action.Kind != protocol.CodeActionQuickFix ||
		len(action.Diagnostics) != 1 ||
		action.Edit == nil ||
		len(action.Edit.DocumentChanges) != 1 {
		t.Fatalf("action = %#v, want exact sequence quick fix", action)
	}
	documentEdit := action.Edit.DocumentChanges[0]
	if documentEdit.TextDocument.Version != 9 ||
		len(documentEdit.Edits) != 1 ||
		documentEdit.Edits[0].Range != editRange ||
		documentEdit.Edits[0].NewText != newText {
		t.Fatalf("document edit = %#v, want exact sequence bytes", documentEdit)
	}
}

type sequenceFixture struct {
	invalidDiagnosticFixture
	layoutRange protocol.Range
}

func (f *sequenceFixture) setJoinable(t *testing.T, joinable bool) {
	t.Helper()
	f.request.Views = mutatingDiagnosticViewProvider{
		base: f.request.Views,
		mutate: func(view *indexview.ProjectIndexView) {
			diagnostic := view.Publication.Diagnostics[f.request.File][0]
			cause := map[string]any{"kind": "inline-sequence"}
			if joinable {
				cause["joinableWithComma"] = true
			}
			diagnostic.Evidence, _ = json.Marshal(map[string]any{
				"kind": "prompt-text", "sourceRefId": "prompt:sequence:source",
				"interpolationIndex": 0, "proof": "semantic-exact",
				"cause": cause,
			})
			view.Publication.Diagnostics[f.request.File][0] = diagnostic
		},
	}
}

func promptTextSequenceFixture(t *testing.T) sequenceFixture {
	t.Helper()
	const (
		root = "/repo"
		file = "/repo/src/sequence.ts"
		text = "import { md as text } from \"@use-crux/core\"\n" +
			"const value = text`head ${items /* once */} tail`\n"
		id      = "prompt-text:0000000000000000000000000000000000000000000000000000000000000002"
		message = "PromptText interpolation 0 is a sequence in inline position. Move it to its own line or join supported scalar values explicitly."
	)
	uri := protocol.DocumentURI("file:///repo/src/sequence.ts")
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 9, Text: text,
		Revision: transient.NewRevision(4, 9, text),
	}
	template := sourceRange(file, text, "text`head ${items /* once */} tail`")
	expression := sourceRange(file, text, "items /* once */")
	barrier := sourceRange(file, text, "${items /* once */}")
	layout := sourceRange(file, text, " ${items /* once */} ")
	analysis := readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file, Revision: document.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Range: sourceProtocolRange(template), TagRange: sourceProtocolRange(
				sourceRange(file, text, "text"),
			),
			TemplateRange: sourceProtocolRange(template),
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			InterpolationBarriers: []staticprotocol.PromptTextInterpolationBarrier{{
				Index: 0, Range: sourceProtocolRange(barrier),
				ExpressionRange: sourceProtocolRange(expression),
				LineIsolationEdit: &staticprotocol.PromptTextLineIsolationEdit{
					Range:        sourceProtocolRange(layout),
					ExpectedText: " ${items /* once */} ",
					NewText:      "\n${items /* once */}\n",
				},
			}},
		}},
	}
	evidence, _ := json.Marshal(map[string]any{
		"kind": "prompt-text", "sourceRefId": "prompt:sequence:source",
		"interpolationIndex": 0, "proof": "semantic-exact",
		"cause": map[string]any{
			"kind": "inline-sequence", "joinableWithComma": true,
		},
	})
	generation := uint64(5)
	store := readmodel.NewStore()
	store.ApplySnapshot(root, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:sequence", Kind: "prompt",
			SourceRefs: []api.ProjectSourceRef{{
				ID: "prompt:sequence:source", Role: "prompt", Property: "prompt",
				Source: api.SourceLoc{
					File: file, Line: template.StartLine, Column: template.StartColumn,
				},
				Snippet: &api.SourceSnippet{
					Source:   "text`head ${items /* once */} tail`",
					Language: "typescript", Range: template,
				},
				Fidelity: "resolved", Metadata: map[string]any{
					"promptText": map[string]any{
						"tag": "md", "language": "markdown", "lifecycle": "static",
						"sourceKind": "owner",
					},
				},
			}},
		}},
		Diagnostics: []api.IndexDiagnostic{{
			ID: id, Severity: "error", Code: "CRUX_PROMPT_TEXT_INLINE_SEQUENCE",
			Message: message,
			Source: &api.SourceLoc{
				File: file, Line: expression.StartLine, Column: expression.StartColumn,
			},
			RelatedDefinitionIDs: []string{"prompt:sequence"}, Evidence: evidence,
		}},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: document.Revision.SourceHash,
			Diagnostics: []string{id},
		}},
	})
	views := indexview.NewSavedProvider(store)
	selection := views.BestAvailableView(indexview.ViewRequest{
		ScopeID: root, File: file,
		Document: &indexview.DocumentRevision{
			OpenEpoch: 4, Version: 9, SourceHash: document.Revision.SourceHash,
		},
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.RequireCurrent,
	})
	return sequenceFixture{
		invalidDiagnosticFixture: invalidDiagnosticFixture{
			document: document,
			request: Request{
				URI: uri, File: file, Root: root, ScopeID: root, SourceEpoch: 3,
				Analyzer: fixedTransientSource{result: analysis}, Views: views,
			},
			analysis: analysis, viewStamp: selection.View.Stamp,
			expressionRange: editorRange(sourceProtocolRange(expression)),
			diagnosticID:    id, message: message,
		},
		layoutRange: editorRange(sourceProtocolRange(layout)),
	}
}
