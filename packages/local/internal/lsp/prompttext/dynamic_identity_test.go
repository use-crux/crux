package prompttext

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerDecoratesNestedDynamicCanonicalSemanticRefs(t *testing.T) {
	t.Parallel()

	const (
		file      = "/repo/src/dynamic.ts"
		outerText = "text`# Outer ${items.map((item) => text`## Inner`)}`"
		innerText = "text`## Inner`"
		source    = "const value = " + outerText + "\n"
	)
	outerStart := strings.Index(source, outerText)
	innerStart := strings.Index(source, innerText)
	document := transient.Document{
		URI:        protocol.DocumentURI("file:///repo/src/dynamic.ts"),
		LanguageID: "typescript",
		Version:    1,
		Text:       source,
		Revision:   transient.NewRevision(1, 1, source),
	}
	outer := dynamicPromptTextSourceRef(
		"prompt:dynamic:source:outer",
		file,
		outerText,
		outerStart,
		"owner",
	)
	inner := dynamicPromptTextSourceRef(
		"prompt:dynamic:source:inner",
		file,
		innerText,
		innerStart,
		"anonymous-fragment",
	)
	analysis := readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file,
		Revision:        document.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{
			dynamicHeadingTemplate(0, outerStart, len(outerText), 5, "Outer", 1),
			dynamicHeadingTemplate(1, innerStart, len(innerText), 5, "Inner", 2),
		},
	}
	controller := NewController(&fixedDocumentSource{document: document})
	request := Request{
		URI: document.URI, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: semanticIdentityProvider(document, file, outer, inner),
	}

	decorations := controller.Decorations(context.Background(), request)
	if len(decorations.Decorations) != 2 ||
		decorations.Decorations[0].Role != DecorationRoleHeading ||
		decorations.Decorations[1].Role != DecorationRoleHeading {
		t.Fatalf("nested dynamic decorations = %#v, want two headings", decorations)
	}
	symbols := controller.Symbols(context.Background(), request)
	if len(symbols.Symbols) != 2 ||
		symbols.Symbols[0].Name != "Outer" ||
		symbols.Symbols[1].Name != "Inner" {
		t.Fatalf("nested dynamic symbols = %#v, want Outer then Inner", symbols)
	}
}

func dynamicPromptTextSourceRef(
	id string,
	file string,
	source string,
	start int,
	sourceKind string,
) api.ProjectSourceRef {
	startColumn := start + 1
	endColumn := startColumn + len(source)
	return api.ProjectSourceRef{
		ID: id, Role: "prompt", Property: "prompt", Fidelity: "resolved",
		Source: api.SourceLoc{File: file, Line: 1, Column: intPointer(startColumn)},
		Snippet: &api.SourceSnippet{
			Source: source, Language: "typescript",
			Range: api.SourceRange{
				File: file, StartLine: 1, StartColumn: intPointer(startColumn),
				EndLine: intPointer(1), EndColumn: intPointer(endColumn),
			},
		},
		Metadata: map[string]any{"promptText": map[string]any{
			"tag": "md", "language": "markdown", "lifecycle": "dynamic",
			"sourceKind": sourceKind,
		}},
	}
}

func dynamicHeadingTemplate(
	candidateID uint32,
	templateStart int,
	templateLength int,
	headingOffset int,
	label string,
	level uint8,
) staticprotocol.PromptTextTemplate {
	headingStart := templateStart + headingOffset
	headingEnd := headingStart + int(level) + 1 + len(label)
	textStart := headingStart + int(level) + 1
	return staticprotocol.PromptTextTemplate{
		CandidateID: candidateID,
		Range:       promptTextLineRange(templateStart, templateStart+templateLength),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
			Index: 0, Range: promptTextLineRange(headingStart, headingEnd),
		}},
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Blocks: []staticprotocol.PromptTextBlock{{
			Kind: staticprotocol.PromptTextBlockHeading, Level: level,
			Label: promptTextLabel(label),
			Range: promptTextLineRange(headingStart, headingEnd),
			TextRange: func() *staticprotocol.PromptTextRange {
				value := promptTextLineRange(textStart, headingEnd)
				return &value
			}(),
		}},
	}
}

func promptTextLineRange(start, end int) staticprotocol.PromptTextRange {
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Character: uint32(start)},
		End:   staticprotocol.PromptTextPosition{Character: uint32(end)},
	}
}
