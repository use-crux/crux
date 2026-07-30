package prompttext

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestTemplateFoldingBoundsNestedHeadingsByStructuralParent(t *testing.T) {
	t.Parallel()

	blockNode := func(index uint32) staticprotocol.PromptTextNodeRef {
		return staticprotocol.PromptTextNodeRef{
			Kind: staticprotocol.PromptTextNodeBlock, Index: index,
		}
	}
	template := staticprotocol.PromptTextTemplate{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		TagRange: foldingSourceRange(0, 0, 0, 2),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
			Index: 0, Range: foldingSourceRange(0, 3, 11, 0),
		}},
		Blocks: []staticprotocol.PromptTextBlock{
			{
				Kind: staticprotocol.PromptTextBlockBlockquote, Index: 0, Island: 0,
				Range: foldingSourceRange(0, 3, 4, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockHeading, Index: 1, Island: 0, Level: 1,
				Range: foldingSourceRange(1, 2, 2, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockList, Index: 2, Island: 0,
				Range: foldingSourceRange(4, 0, 9, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockListItem, Index: 3, Island: 0,
				Range: foldingSourceRange(4, 0, 9, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockHeading, Index: 4, Island: 0, Level: 1,
				Range: foldingSourceRange(5, 2, 6, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockHeading, Index: 5, Island: 0, Level: 1,
				Range: foldingSourceRange(10, 0, 11, 0),
			},
		},
		Nesting: []staticprotocol.PromptTextNesting{
			{Parent: blockNode(0), Child: blockNode(1)},
			{Parent: blockNode(2), Child: blockNode(3)},
			{Parent: blockNode(3), Child: blockNode(4)},
		},
	}

	want := []protocol.FoldingRange{
		{StartLine: 0, EndLine: 3},
		{StartLine: 1, EndLine: 3},
		{StartLine: 4, EndLine: 8},
		{StartLine: 5, EndLine: 8},
	}
	got := templateFoldingRanges(template)
	if len(got) != len(want) {
		t.Fatalf("nested folding = %#v, want %#v", got, want)
	}
	for index := range want {
		if !foldingRangeEqual(got[index], want[index]) {
			t.Fatalf("nested folding %d = %#v, want %#v", index, got[index], want[index])
		}
	}
}
