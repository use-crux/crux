package prompttext

import (
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestTemplateHeadingSymbolsNestByLevelAndResetAtIsland(t *testing.T) {
	t.Parallel()

	template := staticprotocol.PromptTextTemplate{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		TagRange: promptTextRange(0, 14, 0, 16),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{
			{Index: 0, Range: promptTextRange(0, 17, 5, 0)},
			{Index: 1, Range: promptTextRange(5, 7, 8, 0)},
		},
		InterpolationBarriers: []staticprotocol.PromptTextInterpolationBarrier{{
			Index: 0, Range: promptTextRange(5, 0, 5, 7),
			ExpressionRange: promptTextRange(5, 2, 5, 6),
		}},
		Blocks: []staticprotocol.PromptTextBlock{
			headingBlock(0, 0, 1, "Root", promptTextRange(0, 17, 1, 0), promptTextRange(0, 19, 0, 23)),
			headingBlock(1, 0, 2, "Child", promptTextRange(1, 0, 2, 0), promptTextRange(1, 3, 1, 8)),
			headingBlock(2, 0, 4, "Grand", promptTextRange(2, 0, 3, 0), promptTextRange(2, 5, 2, 10)),
			headingBlock(3, 0, 2, "Sibling", promptTextRange(3, 0, 4, 0), promptTextRange(3, 3, 3, 10)),
			headingBlock(4, 1, 2, "Island", promptTextRange(6, 0, 7, 0), promptTextRange(6, 3, 6, 9)),
		},
	}

	got := templateHeadingSymbols(template)
	want := []protocol.DocumentSymbol{
		{
			Name: "Root", Kind: protocol.SymbolKindString,
			Range:          editorRange(promptTextRange(0, 17, 1, 0)),
			SelectionRange: editorRange(promptTextRange(0, 19, 0, 23)),
			Children: []protocol.DocumentSymbol{{
				Name: "Child", Kind: protocol.SymbolKindString,
				Range:          editorRange(promptTextRange(1, 0, 2, 0)),
				SelectionRange: editorRange(promptTextRange(1, 3, 1, 8)),
				Children: []protocol.DocumentSymbol{{
					Name: "Grand", Kind: protocol.SymbolKindString,
					Range:          editorRange(promptTextRange(2, 0, 3, 0)),
					SelectionRange: editorRange(promptTextRange(2, 5, 2, 10)),
				}},
			}, {
				Name: "Sibling", Kind: protocol.SymbolKindString,
				Range:          editorRange(promptTextRange(3, 0, 4, 0)),
				SelectionRange: editorRange(promptTextRange(3, 3, 3, 10)),
			}},
		},
		{
			Name: "Island", Kind: protocol.SymbolKindString,
			Range:          editorRange(promptTextRange(6, 0, 7, 0)),
			SelectionRange: editorRange(promptTextRange(6, 3, 6, 9)),
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("symbols = %#v, want %#v", got, want)
	}
}

func TestTemplateHeadingSymbolsPreserveRustLabelsAndRejectInvalidRanges(t *testing.T) {
	t.Parallel()

	template := staticprotocol.PromptTextTemplate{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		TagRange: promptTextRange(0, 14, 0, 16),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
			Index: 0, Range: promptTextRange(0, 17, 6, 0),
		}},
		Blocks: []staticprotocol.PromptTextBlock{
			headingBlock(0, 0, 1, "Same", promptTextRange(0, 17, 1, 0), promptTextRange(0, 19, 0, 23)),
			headingBlock(1, 0, 1, "Same", promptTextRange(1, 0, 2, 0), promptTextRange(1, 2, 1, 6)),
			headingBlock(2, 0, 1, "Heading 1", promptTextRange(2, 0, 3, 0), promptTextRange(2, 1, 2, 1)),
			headingBlock(3, 0, 1, "Hé😀 *literal*", promptTextRange(3, 0, 4, 0), promptTextRange(3, 2, 3, 16)),
			headingBlock(4, 0, 1, "Outside", promptTextRange(4, 0, 5, 0), promptTextRange(5, 0, 5, 3)),
		},
	}

	got := templateHeadingSymbols(template)
	names := make([]string, 0, len(got))
	for _, symbol := range got {
		names = append(names, symbol.Name)
	}
	if !reflect.DeepEqual(names, []string{
		"Same", "Same", "Heading 1", "Hé😀 *literal*",
	}) {
		t.Fatalf("symbol names = %#v, want Rust labels in authored order", names)
	}
	if got[2].SelectionRange.Start != got[2].SelectionRange.End {
		t.Fatalf("empty-heading selection = %#v, want zero width", got[2].SelectionRange)
	}
}

func headingBlock(
	index, island uint32,
	level uint8,
	label string,
	source, text staticprotocol.PromptTextRange,
) staticprotocol.PromptTextBlock {
	return staticprotocol.PromptTextBlock{
		Kind: staticprotocol.PromptTextBlockHeading, Index: index, Island: island,
		Level: level, Label: &label, Range: source, TextRange: &text,
	}
}

func promptTextRange(
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
