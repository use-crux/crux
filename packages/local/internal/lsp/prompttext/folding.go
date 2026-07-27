package prompttext

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type foldingEvidence string

const foldingEvidenceLexical foldingEvidence = "lexical"

// FoldingResult retains the exact document revision for the server's final
// staleness check. Ranges is always non-nil; an empty slice clears folding.
//
// Lexical evidence remains package-private so identity-sensitive consumers
// cannot accidentally treat a tagged-template candidate as canonical Crux
// semantic evidence.
type FoldingResult struct {
	Revision transient.Revision
	Ranges   []protocol.FoldingRange
	evidence foldingEvidence
}

func templateFoldingRanges(
	template staticprotocol.PromptTextTemplate,
) []protocol.FoldingRange {
	if template.Status.Kind != staticprotocol.PromptTextStatusComplete {
		return []protocol.FoldingRange{}
	}

	ranges := make([]protocol.FoldingRange, 0)
	for index, block := range template.Blocks {
		var source staticprotocol.PromptTextRange
		switch block.Kind {
		case staticprotocol.PromptTextBlockHeading:
			source = headingFoldRange(template, index, block)
		case staticprotocol.PromptTextBlockBlockquote,
			staticprotocol.PromptTextBlockList:
			source = block.Range
		case staticprotocol.PromptTextBlockCode:
			if !block.Fenced {
				continue
			}
			source = block.Range
		default:
			continue
		}
		if fold, ok := foldingRange(template, block.Island, source); ok {
			ranges = append(ranges, fold)
		}
	}
	sort.SliceStable(ranges, func(left, right int) bool {
		if ranges[left].StartLine != ranges[right].StartLine {
			return ranges[left].StartLine < ranges[right].StartLine
		}
		return ranges[left].EndLine > ranges[right].EndLine
	})
	return compactFoldingRanges(ranges)
}

func headingFoldRange(
	template staticprotocol.PromptTextTemplate,
	blockIndex int,
	heading staticprotocol.PromptTextBlock,
) staticprotocol.PromptTextRange {
	source := heading.Range
	parentIndex, nested := blockParentIndex(template, heading.Index)
	for _, island := range template.LiteralIslands {
		if island.Index == heading.Island {
			source.End = island.Range.End
			break
		}
	}
	if nested {
		if parent, ok := blockByIndex(template, parentIndex); ok &&
			parent.Island == heading.Island &&
			comparePosition(parent.Range.Start, heading.Range.Start) <= 0 &&
			comparePosition(heading.Range.End, parent.Range.End) <= 0 {
			source.End = parent.Range.End
		}
	}
	for _, candidate := range template.Blocks[blockIndex+1:] {
		if candidate.Island != heading.Island {
			continue
		}
		candidateParent, candidateNested := blockParentIndex(
			template,
			candidate.Index,
		)
		if candidateNested != nested ||
			(nested && candidateParent != parentIndex) {
			continue
		}
		if candidate.Kind == staticprotocol.PromptTextBlockHeading &&
			candidate.Level <= heading.Level &&
			comparePosition(candidate.Range.Start, source.End) < 0 {
			source.End = candidate.Range.Start
			break
		}
	}
	return source
}

func blockParentIndex(
	template staticprotocol.PromptTextTemplate,
	childIndex uint32,
) (uint32, bool) {
	for _, edge := range template.Nesting {
		if edge.Child.Kind == staticprotocol.PromptTextNodeBlock &&
			edge.Child.Index == childIndex &&
			edge.Parent.Kind == staticprotocol.PromptTextNodeBlock {
			return edge.Parent.Index, true
		}
	}
	return 0, false
}

func blockByIndex(
	template staticprotocol.PromptTextTemplate,
	index uint32,
) (staticprotocol.PromptTextBlock, bool) {
	for _, block := range template.Blocks {
		if block.Index == index {
			return block, true
		}
	}
	return staticprotocol.PromptTextBlock{}, false
}

func foldingRange(
	template staticprotocol.PromptTextTemplate,
	islandID uint32,
	source staticprotocol.PromptTextRange,
) (protocol.FoldingRange, bool) {
	if !validStructureRange(template, islandID, source) {
		return protocol.FoldingRange{}, false
	}
	if source.End.Line == 0 {
		return protocol.FoldingRange{}, false
	}
	// VS Code advertises lineFoldingOnly and ignores character bounds. Exclude
	// the partial end line so a fold can never consume an adjacent barrier,
	// template delimiter, or TypeScript suffix.
	endLine := source.End.Line - 1
	if endLine <= source.Start.Line {
		return protocol.FoldingRange{}, false
	}
	return protocol.FoldingRange{
		StartLine: source.Start.Line, EndLine: endLine,
	}, true
}

func validStructureRange(
	template staticprotocol.PromptTextTemplate,
	islandID uint32,
	source staticprotocol.PromptTextRange,
) bool {
	if comparePosition(source.Start, source.End) >= 0 ||
		intersects(source, template.TagRange) {
		return false
	}
	for _, island := range template.LiteralIslands {
		if island.Index == islandID &&
			comparePosition(island.Range.Start, source.Start) <= 0 &&
			comparePosition(source.End, island.Range.End) <= 0 {
			for _, barrier := range template.InterpolationBarriers {
				if intersects(source, barrier.Range) ||
					intersects(source, barrier.ExpressionRange) {
					return false
				}
			}
			return true
		}
	}
	return false
}

func compactFoldingRanges(ranges []protocol.FoldingRange) []protocol.FoldingRange {
	compacted := ranges[:0]
	for _, candidate := range ranges {
		if len(compacted) == 0 || compacted[len(compacted)-1] != candidate {
			compacted = append(compacted, candidate)
		}
	}
	return compacted
}

func emptyFoldingResult(revision transient.Revision) FoldingResult {
	return FoldingResult{
		Revision: revision, Ranges: []protocol.FoldingRange{},
		evidence: foldingEvidenceLexical,
	}
}
