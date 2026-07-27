package prompttext

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerStaticPreviewSelectsSoleTemplateRegardlessOfPosition(t *testing.T) {
	t.Parallel()

	const (
		file = "/repo/writer.ts"
		text = "const value = md`# Hello ${name}`\n"
	)
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	revision := transient.NewRevision(2, 7, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 7, Text: text,
		Revision: revision,
	}
	result := readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file,
		Revision:        revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			CandidateID:   9,
			Range:         previewRange(0, 14, 0, 34),
			TemplateRange: previewRange(0, 16, 0, 34),
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusTruncated,
			},
			Preview: staticprotocol.PromptTextPreview{
				Status: staticprotocol.PromptTextPreviewStatus{
					Kind: staticprotocol.PromptTextPreviewComplete,
				},
				Evidence: previewEvidence(staticprotocol.PromptTextPreviewSyntaxExact),
				Text:     "# Hello ⟪unknown⟫",
				Segments: []staticprotocol.PromptTextPreviewSegment{},
			},
		}},
	}
	controller := NewController(&fixedDocumentSource{document: document})

	got := controller.StaticPreview(context.Background(), Request{
		URI: uri, File: file, ScopeID: "/repo", SourceEpoch: 1,
		Analyzer: fixedTransientSource{result: result},
	}, PreviewTarget{
		Kind:     PreviewTargetPosition,
		Position: protocol.Position{Line: 99, Character: 0},
	})

	if got.Kind != PreviewResultReady ||
		got.Revision != revision ||
		got.Selection.Ordinal != 0 ||
		got.Selection.Range != editorRange(result.Templates[0].Range) ||
		got.RequestStatus != staticprotocol.PromptTextStatusComplete ||
		got.TemplateStatus != staticprotocol.PromptTextStatusTruncated ||
		got.PreviewStatus != staticprotocol.PromptTextPreviewComplete ||
		got.Evidence != staticprotocol.PromptTextPreviewSyntaxExact ||
		got.Text != "# Hello ⟪unknown⟫" {
		t.Fatalf("static preview = %#v", got)
	}
}

func TestControllerStaticPreviewSelectsInnermostOrReturnsSourceOrderChoices(t *testing.T) {
	t.Parallel()

	const (
		file = "/repo/writer.ts"
		text = "012345678901234567890123456789"
	)
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	revision := transient.NewRevision(1, 3, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 3, Text: text,
		Revision: revision,
	}
	outer := readyPreviewTemplate(1, previewRange(0, 0, 0, 20), "outer")
	inner := readyPreviewTemplate(2, previewRange(0, 5, 0, 15), "inner")
	result := readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file,
		Revision:        revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{outer, inner},
	}
	controller := NewController(&fixedDocumentSource{document: document})
	request := Request{
		URI: uri, File: file, ScopeID: "/repo", SourceEpoch: 1,
		Analyzer: fixedTransientSource{result: result},
	}

	selected := controller.StaticPreview(context.Background(), request, PreviewTarget{
		Kind: PreviewTargetPosition, Position: protocol.Position{Character: 10},
	})
	if selected.Kind != PreviewResultReady ||
		selected.Selection.Ordinal != 1 ||
		selected.Selection.Range != editorRange(inner.Range) ||
		selected.Text != "inner" {
		t.Fatalf("innermost result = %#v", selected)
	}

	choices := controller.StaticPreview(context.Background(), request, PreviewTarget{
		Kind: PreviewTargetPosition, Position: protocol.Position{Character: 25},
	})
	if choices.Kind != PreviewResultChoose ||
		choices.RequestStatus != staticprotocol.PromptTextStatusComplete ||
		len(choices.Choices) != 2 ||
		choices.Choices[0].Ordinal != 0 ||
		choices.Choices[0].Range != editorRange(outer.Range) ||
		choices.Choices[1].Ordinal != 1 ||
		choices.Choices[1].Range != editorRange(inner.Range) {
		t.Fatalf("choices = %#v", choices)
	}

	rematched := controller.StaticPreview(context.Background(), request, PreviewTarget{
		Kind: PreviewTargetTemplateRange, Range: editorRange(inner.Range),
	})
	if rematched.Kind != PreviewResultReady ||
		rematched.Selection.Ordinal != 1 ||
		rematched.Text != "inner" {
		t.Fatalf("exact range result = %#v", rematched)
	}
}

func TestControllerStaticPreviewReturnsOnlyTiedInnermostChoices(t *testing.T) {
	t.Parallel()

	const text = "012345678901234567890123456789"
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	revision := transient.NewRevision(1, 1, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: text,
		Revision: revision,
	}
	result := readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            "/repo/writer.ts",
		Revision:        revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusTruncated,
		},
		Templates: []staticprotocol.PromptTextTemplate{
			readyPreviewTemplate(1, previewRange(0, 0, 0, 20), "outer"),
			readyPreviewTemplate(2, previewRange(0, 5, 0, 15), "first"),
			readyPreviewTemplate(3, previewRange(0, 7, 0, 17), "second"),
		},
	}
	controller := NewController(&fixedDocumentSource{document: document})

	got := controller.StaticPreview(context.Background(), Request{
		URI: uri, File: result.File, ScopeID: "/repo", SourceEpoch: 1,
		Analyzer: fixedTransientSource{result: result},
	}, PreviewTarget{
		Kind: PreviewTargetPosition, Position: protocol.Position{Character: 10},
	})

	if got.Kind != PreviewResultChoose ||
		got.RequestStatus != staticprotocol.PromptTextStatusTruncated ||
		len(got.Choices) != 2 ||
		got.Choices[0].Ordinal != 1 ||
		got.Choices[1].Ordinal != 2 {
		t.Fatalf("tied innermost result = %#v", got)
	}
}

func TestStaticPreviewRejectsIndistinguishableChoiceRanges(t *testing.T) {
	t.Parallel()

	templates := []staticprotocol.PromptTextTemplate{
		readyPreviewTemplate(1, previewRange(0, 2, 0, 8), "first"),
		readyPreviewTemplate(2, previewRange(0, 2, 0, 8), "second"),
	}
	for _, position := range []protocol.Position{
		{Character: 4},
		{Character: 10},
	} {
		_, choices, reason := selectPreviewTemplate(templates, PreviewTarget{
			Kind: PreviewTargetPosition, Position: position,
		})
		if reason != "template-ambiguous" || len(choices) != 0 {
			t.Fatalf(
				"position %v: choices = %#v, reason = %q",
				position,
				choices,
				reason,
			)
		}
	}
}

func readyPreviewTemplate(
	candidateID uint32,
	sourceRange staticprotocol.PromptTextRange,
	text string,
) staticprotocol.PromptTextTemplate {
	return staticprotocol.PromptTextTemplate{
		CandidateID: candidateID,
		Range:       sourceRange,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Preview: staticprotocol.PromptTextPreview{
			Status: staticprotocol.PromptTextPreviewStatus{
				Kind: staticprotocol.PromptTextPreviewComplete,
			},
			Evidence: previewEvidence(staticprotocol.PromptTextPreviewSyntaxExact),
			Text:     text,
			Segments: []staticprotocol.PromptTextPreviewSegment{},
		},
	}
}

func previewRange(
	startLine, startCharacter, endLine, endCharacter uint32,
) staticprotocol.PromptTextRange {
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{
			Line: startLine, Character: startCharacter,
		},
		End: staticprotocol.PromptTextPosition{
			Line: endLine, Character: endCharacter,
		},
	}
}

func previewEvidence(
	value staticprotocol.PromptTextPreviewEvidence,
) *staticprotocol.PromptTextPreviewEvidence {
	return &value
}
