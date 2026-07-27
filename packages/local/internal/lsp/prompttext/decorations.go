package prompttext

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// DecorationRole is the closed visual vocabulary understood by the VS Code client.
type DecorationRole = protocol.PromptTextDecorationRole

const (
	DecorationRoleHeading    = protocol.PromptTextDecorationRoleHeading
	DecorationRoleLink       = protocol.PromptTextDecorationRoleLink
	DecorationRoleCode       = protocol.PromptTextDecorationRoleCode
	DecorationRoleEmphasis   = protocol.PromptTextDecorationRoleEmphasis
	DecorationRoleStrong     = protocol.PromptTextDecorationRoleStrong
	DecorationRoleList       = protocol.PromptTextDecorationRoleList
	DecorationRoleBlockquote = protocol.PromptTextDecorationRoleBlockquote
)

// Decoration assigns one visual role to a zero-based UTF-16 source range.
type Decoration = protocol.PromptTextDecoration

// Result is a clear-or-replace decoration payload for one exact revision.
// Decorations is always non-nil; an empty slice means clear.
type Result struct {
	Revision    transient.Revision
	Decorations []Decoration
}

func templateDecorations(template staticprotocol.PromptTextTemplate) []Decoration {
	decorations := make([]Decoration, 0)
	appendRange := func(role DecorationRole, source staticprotocol.PromptTextRange) {
		if validDecorationRange(template, source) {
			decorations = append(decorations, Decoration{
				Role: role, Range: editorRange(source),
			})
		}
	}
	for _, block := range template.Blocks {
		switch block.Kind {
		case staticprotocol.PromptTextBlockHeading:
			if block.TextRange != nil {
				appendRange(DecorationRoleHeading, *block.TextRange)
			}
		case staticprotocol.PromptTextBlockBlockquote:
			for _, marker := range block.MarkerRanges {
				appendRange(DecorationRoleBlockquote, marker)
			}
		case staticprotocol.PromptTextBlockListItem:
			if block.MarkerRange != nil {
				appendRange(DecorationRoleList, *block.MarkerRange)
			}
		case staticprotocol.PromptTextBlockCode:
			if block.ContentRange != nil {
				appendRange(DecorationRoleCode, *block.ContentRange)
			}
		}
	}
	for _, span := range template.Spans {
		if span.TextRange == nil {
			continue
		}
		switch span.Kind {
		case staticprotocol.PromptTextSpanEmphasis:
			appendRange(DecorationRoleEmphasis, *span.TextRange)
		case staticprotocol.PromptTextSpanStrong:
			appendRange(DecorationRoleStrong, *span.TextRange)
		case staticprotocol.PromptTextSpanInlineCode:
			appendRange(DecorationRoleCode, *span.TextRange)
		}
	}
	for _, link := range template.Links {
		if link.Kind == staticprotocol.PromptTextLinkInline ||
			link.Kind == staticprotocol.PromptTextLinkAutolink {
			appendRange(DecorationRoleLink, link.TextRange)
		}
	}
	sort.SliceStable(decorations, func(left, right int) bool {
		return compareDecoration(decorations[left], decorations[right]) < 0
	})
	return decorations
}

func validDecorationRange(
	template staticprotocol.PromptTextTemplate,
	source staticprotocol.PromptTextRange,
) bool {
	if comparePosition(source.Start, source.End) >= 0 {
		return false
	}
	contained := false
	for _, island := range template.LiteralIslands {
		if comparePosition(island.Range.Start, source.Start) <= 0 &&
			comparePosition(source.End, island.Range.End) <= 0 {
			contained = true
			break
		}
	}
	if !contained || intersects(source, template.TagRange) {
		return false
	}
	for _, barrier := range template.InterpolationBarriers {
		if intersects(source, barrier.Range) || intersects(source, barrier.ExpressionRange) {
			return false
		}
	}
	return true
}

func intersects(left, right staticprotocol.PromptTextRange) bool {
	return comparePosition(left.Start, right.End) < 0 &&
		comparePosition(right.Start, left.End) < 0
}

func compareDecoration(left, right Decoration) int {
	if position := compareEditorPosition(left.Range.Start, right.Range.Start); position != 0 {
		return position
	}
	if position := compareEditorPosition(left.Range.End, right.Range.End); position != 0 {
		return position
	}
	return roleRank(left.Role) - roleRank(right.Role)
}

func comparePosition(
	left, right staticprotocol.PromptTextPosition,
) int {
	if left.Line != right.Line {
		if left.Line < right.Line {
			return -1
		}
		return 1
	}
	if left.Character < right.Character {
		return -1
	}
	if left.Character > right.Character {
		return 1
	}
	return 0
}

func compareEditorPosition(left, right protocol.Position) int {
	if left.Line != right.Line {
		if left.Line < right.Line {
			return -1
		}
		return 1
	}
	if left.Character < right.Character {
		return -1
	}
	if left.Character > right.Character {
		return 1
	}
	return 0
}

func roleRank(role DecorationRole) int {
	for index, candidate := range [...]DecorationRole{
		DecorationRoleHeading,
		DecorationRoleLink,
		DecorationRoleCode,
		DecorationRoleEmphasis,
		DecorationRoleStrong,
		DecorationRoleList,
		DecorationRoleBlockquote,
	} {
		if role == candidate {
			return index
		}
	}
	return 7
}

func editorRange(source staticprotocol.PromptTextRange) protocol.Range {
	return protocol.Range{
		Start: protocol.Position{
			Line: source.Start.Line, Character: source.Start.Character,
		},
		End: protocol.Position{
			Line: source.End.Line, Character: source.End.Character,
		},
	}
}
