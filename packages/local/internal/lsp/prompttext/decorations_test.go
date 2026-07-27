package prompttext

import (
	"reflect"
	"testing"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestTemplateDecorationsProjectsEveryRoleInAuthoredOrder(t *testing.T) {
	t.Parallel()

	headingText := staticRange(0, 2, 0, 7)
	blockquoteMarker := staticRange(1, 0, 1, 1)
	listMarker := staticRange(2, 0, 2, 1)
	codeBlockContent := staticRange(3, 3, 3, 7)
	strongText := staticRange(0, 10, 0, 14)
	emphasisText := staticRange(1, 3, 1, 10)
	inlineCodeText := staticRange(4, 1, 4, 5)
	template := staticprotocol.PromptTextTemplate{
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
			Index: 0, Range: staticRange(0, 0, 5, 0),
		}},
		Blocks: []staticprotocol.PromptTextBlock{
			{Kind: staticprotocol.PromptTextBlockHeading, TextRange: &headingText},
			{
				Kind:         staticprotocol.PromptTextBlockBlockquote,
				MarkerRanges: []staticprotocol.PromptTextRange{blockquoteMarker},
			},
			{Kind: staticprotocol.PromptTextBlockListItem, MarkerRange: &listMarker},
			{Kind: staticprotocol.PromptTextBlockCode, ContentRange: &codeBlockContent},
		},
		Spans: []staticprotocol.PromptTextSpan{
			{Kind: staticprotocol.PromptTextSpanStrong, TextRange: &strongText},
			{Kind: staticprotocol.PromptTextSpanEmphasis, TextRange: &emphasisText},
			{Kind: staticprotocol.PromptTextSpanInlineCode, TextRange: &inlineCodeText},
		},
		Links: []staticprotocol.PromptTextLink{{
			Kind:      staticprotocol.PromptTextLinkInline,
			TextRange: staticRange(2, 8, 2, 13),
		}},
	}

	got := templateDecorations(template)
	want := []Decoration{
		decoration(DecorationRoleHeading, headingText),
		decoration(DecorationRoleStrong, strongText),
		decoration(DecorationRoleBlockquote, blockquoteMarker),
		decoration(DecorationRoleEmphasis, emphasisText),
		decoration(DecorationRoleList, listMarker),
		decoration(DecorationRoleLink, staticRange(2, 8, 2, 13)),
		decoration(DecorationRoleCode, codeBlockContent),
		decoration(DecorationRoleCode, inlineCodeText),
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("decorations = %#v, want %#v", got, want)
	}
}

func TestTemplateDecorationsRejectsRangesOutsideLiteralIslands(t *testing.T) {
	t.Parallel()

	valid := staticRange(0, 2, 0, 7)
	barrier := staticRange(0, 8, 0, 15)
	invalid := staticRange(0, 7, 0, 9)
	template := staticprotocol.PromptTextTemplate{
		LiteralIslands: []staticprotocol.PromptTextLiteralIsland{
			{Index: 0, Range: staticRange(0, 1, 0, 8)},
			{Index: 1, Range: staticRange(0, 15, 0, 20)},
		},
		InterpolationBarriers: []staticprotocol.PromptTextInterpolationBarrier{{
			Index: 0, Range: barrier, ExpressionRange: staticRange(0, 10, 0, 14),
		}},
		Blocks: []staticprotocol.PromptTextBlock{
			{Kind: staticprotocol.PromptTextBlockHeading, TextRange: &valid},
			{Kind: staticprotocol.PromptTextBlockHeading, TextRange: &invalid},
		},
	}

	got := templateDecorations(template)
	want := []Decoration{decoration(DecorationRoleHeading, valid)}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("decorations = %#v, want only contained role %#v", got, want)
	}
}

func decoration(role DecorationRole, source staticprotocol.PromptTextRange) Decoration {
	return Decoration{Role: role, Range: editorRange(source)}
}

func staticRange(
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
