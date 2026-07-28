package prompttext

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextLayoutActionRejectsMalformedProofs(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		mutate func(
			*staticprotocol.PromptTextTemplate,
			*staticprotocol.PromptTextInterpolationBarrier,
		)
	}{
		{
			name: "absent",
			mutate: func(
				_ *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit = nil
			},
		},
		{
			name: "empty expected text",
			mutate: func(
				_ *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit.ExpectedText = ""
			},
		},
		{
			name: "equal replacement text",
			mutate: func(
				_ *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit.NewText =
					barrier.LineIsolationEdit.ExpectedText
			},
		},
		{
			name: "range reaches template delimiters",
			mutate: func(
				template *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit.Range = template.TemplateRange
			},
		},
		{
			name: "authored scaffolding contains newline",
			mutate: func(
				_ *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit.ExpectedText =
					"\n${items /* once */} "
			},
		},
		{
			name: "replacement has no line ending",
			mutate: func(
				_ *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit.NewText =
					"\t${items /* once */}\t"
			},
		},
		{
			name: "replacement has bare carriage return",
			mutate: func(
				_ *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit.NewText =
					"\r${items /* once */}\r"
			},
		},
		{
			name: "replacement has multiple line endings on one side",
			mutate: func(
				_ *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit.NewText =
					"\n\n${items /* once */}\n"
			},
		},
		{
			name: "replacement indents before its line ending",
			mutate: func(
				_ *staticprotocol.PromptTextTemplate,
				barrier *staticprotocol.PromptTextInterpolationBarrier,
			) {
				barrier.LineIsolationEdit.NewText =
					" \n${items /* once */}\n"
			},
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			fixture := promptTextSequenceFixture(t)
			template := &fixture.analysis.Templates[0]
			barrier := &template.InterpolationBarriers[0]
			test.mutate(template, barrier)
			fixture.request.Analyzer = fixedTransientSource{
				result: fixture.analysis,
			}

			actions := promptTextSequenceActions(t, fixture)
			if len(actions) != 1 || actions[0].Title != `.join(", ")` {
				t.Fatalf("actions = %#v, want only independent join", actions)
			}
		})
	}
}

func TestPromptTextSequenceActionsRejectDuplicateExpressionRange(t *testing.T) {
	t.Parallel()

	fixture := promptTextSequenceFixture(t)
	template := &fixture.analysis.Templates[0]
	duplicate := template.InterpolationBarriers[0]
	duplicate.Index = 1
	duplicate.LineIsolationEdit = nil
	template.InterpolationBarriers = append(template.InterpolationBarriers, duplicate)
	fixture.request.Analyzer = fixedTransientSource{result: fixture.analysis}

	if actions := promptTextSequenceActions(t, fixture); len(actions) != 0 {
		t.Fatalf("duplicate expression actions = %#v, want none", actions)
	}
}

func TestPromptTextLayoutProofRequiresStrictInnerExpressionRange(t *testing.T) {
	t.Parallel()

	fixture := promptTextSequenceFixture(t)
	template := fixture.analysis.Templates[0]
	barrier := template.InterpolationBarriers[0]
	barrier.ExpressionRange.Start = barrier.Range.Start

	if edit := validatedLineIsolationEdit(
		fixture.document.Text,
		template,
		barrier,
	); edit != nil {
		t.Fatalf("non-strict expression proof = %#v, want unavailable", edit)
	}
}

func TestPromptTextLayoutActionCopiesProvenCRLFAndIndentation(t *testing.T) {
	t.Parallel()

	fixture := promptTextSequenceFixture(t)
	proof := fixture.analysis.Templates[0].InterpolationBarriers[0].
		LineIsolationEdit
	proof.NewText = "\r\n\t${items /* once */}\r\n\t"
	fixture.request.Analyzer = fixedTransientSource{result: fixture.analysis}

	actions := promptTextSequenceActions(t, fixture)
	if len(actions) != 2 {
		t.Fatalf("actions = %#v, want join and layout", actions)
	}
	edit := actions[1].Edit.DocumentChanges[0].Edits[0]
	if edit.NewText != proof.NewText {
		t.Fatalf("layout edit = %#v, want exact Rust CRLF bytes", edit)
	}
}

func promptTextSequenceActions(
	t *testing.T,
	fixture sequenceFixture,
) []protocol.CodeAction {
	t.Helper()
	controller := NewController(&fixedDocumentSource{document: fixture.document})
	result := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	return result.Actions
}

func TestPromptTextSequenceActionPreservesCurrentRevision(t *testing.T) {
	t.Parallel()

	fixture := promptTextSequenceFixture(t)
	stale := fixture.document
	stale.Revision = transient.NewRevision(
		fixture.document.Revision.OpenEpoch,
		int(fixture.document.Revision.Version)+1,
		fixture.document.Text,
	)
	controller := NewController(&fixedDocumentSource{document: stale})
	result := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	if len(result.Actions) != 0 {
		t.Fatalf("stale actions = %#v, want none", result.Actions)
	}
}
