package prompttext

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestTemplateFoldingRejectsBlockWithMismatchedIslandEvidence(t *testing.T) {
	t.Parallel()

	template := staticprotocol.PromptTextTemplate{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		TagRange: foldingSourceRange(0, 0, 0, 2),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{
			{Index: 0, Range: foldingSourceRange(0, 3, 2, 0)},
			{Index: 1, Range: foldingSourceRange(2, 7, 5, 0)},
		},
		Blocks: []staticprotocol.PromptTextBlock{{
			Kind: staticprotocol.PromptTextBlockBlockquote,
			// The range is inside island 1, but the normalized block claims
			// island 0. Go must fail closed instead of relabelling evidence.
			Island: 0,
			Range:  foldingSourceRange(2, 7, 5, 0),
		}},
	}

	if got := templateFoldingRanges(template); len(got) != 0 {
		t.Fatalf("mismatched-island folds = %#v, want none", got)
	}
}

func TestTemplateFoldingProjectsHeadingSectionsAndNestedBlocks(t *testing.T) {
	t.Parallel()

	template := staticprotocol.PromptTextTemplate{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		TagRange: foldingSourceRange(0, 0, 0, 2),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
			Index: 0, Range: foldingSourceRange(0, 3, 15, 2),
		}},
		Blocks: []staticprotocol.PromptTextBlock{
			{
				Kind: staticprotocol.PromptTextBlockHeading, Island: 0, Level: 1,
				Range: foldingSourceRange(0, 3, 1, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockBlockquote, Island: 0,
				Range: foldingSourceRange(1, 0, 4, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockList, Island: 0,
				Range: foldingSourceRange(2, 2, 4, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockCode, Island: 0, Fenced: true,
				Range: foldingSourceRange(4, 0, 8, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockHeading, Island: 0, Level: 2,
				Range: foldingSourceRange(8, 0, 9, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockBlockquote, Island: 0,
				Range: foldingSourceRange(9, 0, 10, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockHeading, Island: 0, Level: 1,
				Range: foldingSourceRange(12, 0, 13, 0),
			},
			{
				Kind: staticprotocol.PromptTextBlockCode, Island: 0, Fenced: false,
				Range: foldingSourceRange(13, 0, 15, 2),
			},
		},
	}

	want := []protocol.FoldingRange{
		{StartLine: 0, EndLine: 11},
		{StartLine: 1, EndLine: 3},
		{StartLine: 2, EndLine: 3},
		{StartLine: 4, EndLine: 7},
		{StartLine: 8, EndLine: 11},
		{StartLine: 12, EndLine: 14},
	}
	got := templateFoldingRanges(template)
	if len(got) != len(want) {
		t.Fatalf("folding ranges = %#v, want %#v", got, want)
	}
	for index := range want {
		if !foldingRangeEqual(got[index], want[index]) {
			t.Fatalf("folding range %d = %#v, want %#v", index, got[index], want[index])
		}
	}
}

func TestControllerFoldsExplicitLexicalCandidateWithoutSemanticIdentity(t *testing.T) {
	t.Parallel()

	const (
		file = "/repo/src/local.ts"
		text = "const local = md`# Title\nbody\n`;\n"
	)
	uri := protocol.DocumentURI("file:///repo/src/local.ts")
	revision := transient.NewRevision(1, 1, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: text,
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
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			TagRange: foldingSourceRange(0, 14, 0, 16),
			LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
				Index: 0, Range: foldingSourceRange(0, 17, 2, 0),
			}},
			Blocks: []staticprotocol.PromptTextBlock{{
				Kind: staticprotocol.PromptTextBlockHeading, Island: 0, Level: 1,
				Range: foldingSourceRange(0, 17, 1, 0),
			}},
		}},
	}
	controller := NewController(&fixedDocumentSource{document: document})
	request := Request{
		URI: uri, File: file, ScopeID: "/repo", SourceEpoch: 1,
		Analyzer: fixedTransientSource{result: result},
	}

	folding := controller.Folding(context.Background(), request)
	if folding.evidence != foldingEvidenceLexical ||
		len(folding.Ranges) != 1 ||
		folding.Ranges[0].StartLine != 0 ||
		folding.Ranges[0].EndLine != 1 {
		t.Fatalf("lexical folding = %#v, want one explicitly lexical fold", folding)
	}
	decorations := controller.Decorations(context.Background(), request)
	if len(decorations.Decorations) != 0 {
		t.Fatalf("lexical candidate decorations = %#v, want semantic clear", decorations)
	}
}

func TestTemplateFoldingKeepsIncompleteFenceInsideLiteralIsland(t *testing.T) {
	t.Parallel()

	template := staticprotocol.PromptTextTemplate{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		TagRange: foldingSourceRange(0, 14, 0, 16),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
			Index: 0, Range: foldingSourceRange(0, 17, 4, 0),
		}},
		Blocks: []staticprotocol.PromptTextBlock{{
			Kind: staticprotocol.PromptTextBlockCode, Island: 0, Fenced: true,
			// Rust's tolerant CommonMark range ends at the literal island
			// when the authored fence is incomplete.
			Range: foldingSourceRange(0, 17, 4, 0),
		}},
	}

	got := templateFoldingRanges(template)
	want := protocol.FoldingRange{StartLine: 0, EndLine: 3}
	if len(got) != 1 || !foldingRangeEqual(got[0], want) {
		t.Fatalf("incomplete fence folds = %#v, want %#v", got, want)
	}
}

func TestTemplateFoldingSkipsIncompleteTemplatePayload(t *testing.T) {
	t.Parallel()

	template := staticprotocol.PromptTextTemplate{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusTruncated,
		},
		TagRange: foldingSourceRange(0, 0, 0, 2),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
			Index: 0, Range: foldingSourceRange(0, 3, 3, 0),
		}},
		Blocks: []staticprotocol.PromptTextBlock{{
			Kind: staticprotocol.PromptTextBlockBlockquote, Island: 0,
			Range: foldingSourceRange(0, 3, 3, 0),
		}},
	}

	if got := templateFoldingRanges(template); len(got) != 0 {
		t.Fatalf("truncated template folds = %#v, want none", got)
	}
}

func TestTemplateFoldingExcludesPartialEndLineForLineOnlyClients(t *testing.T) {
	t.Parallel()

	template := staticprotocol.PromptTextTemplate{
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		TagRange: foldingSourceRange(0, 0, 0, 2),
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
			Index: 0, Range: foldingSourceRange(0, 3, 3, 5),
		}},
		InterpolationBarriers: []staticprotocol.PromptTextInterpolationBarrier{{
			Index: 0, Range: foldingSourceRange(3, 5, 3, 12),
			ExpressionRange: foldingSourceRange(3, 7, 3, 11),
		}},
		Blocks: []staticprotocol.PromptTextBlock{{
			Kind: staticprotocol.PromptTextBlockHeading, Island: 0, Level: 1,
			Range: foldingSourceRange(0, 3, 1, 0),
		}},
	}

	want := protocol.FoldingRange{StartLine: 0, EndLine: 2}
	got := templateFoldingRanges(template)
	if len(got) != 1 || !foldingRangeEqual(got[0], want) {
		t.Fatalf("line-only folding = %#v, want barrier-safe %#v", got, want)
	}
}

func foldingSourceRange(
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

func foldingRangeEqual(left, right protocol.FoldingRange) bool {
	if left.StartLine != right.StartLine ||
		left.EndLine != right.EndLine ||
		left.Kind != right.Kind ||
		left.CollapsedText != right.CollapsedText {
		return false
	}
	return optionalUint32Equal(left.StartCharacter, right.StartCharacter) &&
		optionalUint32Equal(left.EndCharacter, right.EndCharacter)
}

func optionalUint32Equal(left, right *uint32) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}
