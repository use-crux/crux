package prompttext

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// SymbolResult retains the analyzed revision for the server's final
// staleness check. Symbols is always non-nil.
type SymbolResult struct {
	Revision transient.Revision
	Symbols  []protocol.DocumentSymbol
}

type headingSymbolNode struct {
	symbol   protocol.DocumentSymbol
	level    uint8
	children []*headingSymbolNode
}

func templateHeadingSymbols(
	template staticprotocol.PromptTextTemplate,
) []protocol.DocumentSymbol {
	if template.Status.Kind != staticprotocol.PromptTextStatusComplete {
		return []protocol.DocumentSymbol{}
	}

	headings := make([]staticprotocol.PromptTextHeading, 0)
	for _, block := range template.Blocks {
		if heading, ok := block.Heading(); ok && validHeading(template, heading) {
			headings = append(headings, heading)
		}
	}
	sort.SliceStable(headings, func(left, right int) bool {
		if order := comparePosition(
			headings[left].Range.Start,
			headings[right].Range.Start,
		); order != 0 {
			return order < 0
		}
		return headings[left].Index < headings[right].Index
	})

	roots := make([]*headingSymbolNode, 0)
	stack := make([]*headingSymbolNode, 0)
	var island uint32
	for index, heading := range headings {
		if index == 0 || heading.Island != island {
			stack = stack[:0]
			island = heading.Island
		}
		for len(stack) > 0 && stack[len(stack)-1].level >= heading.Level {
			stack = stack[:len(stack)-1]
		}
		node := &headingSymbolNode{
			level: heading.Level,
			symbol: protocol.DocumentSymbol{
				Name: heading.Label, Kind: protocol.SymbolKindString,
				Range:          editorRange(heading.Range),
				SelectionRange: editorRange(heading.TextRange),
			},
		}
		if len(stack) == 0 {
			roots = append(roots, node)
		} else {
			parent := stack[len(stack)-1]
			parent.children = append(parent.children, node)
		}
		stack = append(stack, node)
	}
	return materializeHeadingSymbols(roots)
}

func validHeading(
	template staticprotocol.PromptTextTemplate,
	heading staticprotocol.PromptTextHeading,
) bool {
	if !validStructureRange(template, heading.Island, heading.Range) ||
		comparePosition(heading.TextRange.Start, heading.TextRange.End) > 0 ||
		comparePosition(heading.Range.Start, heading.TextRange.Start) > 0 ||
		comparePosition(heading.TextRange.End, heading.Range.End) > 0 ||
		intersects(heading.TextRange, template.TagRange) {
		return false
	}
	for _, barrier := range template.InterpolationBarriers {
		if intersects(heading.TextRange, barrier.Range) ||
			intersects(heading.TextRange, barrier.ExpressionRange) {
			return false
		}
	}
	return true
}

func materializeHeadingSymbols(
	nodes []*headingSymbolNode,
) []protocol.DocumentSymbol {
	symbols := make([]protocol.DocumentSymbol, 0, len(nodes))
	for _, node := range nodes {
		symbol := node.symbol
		if len(node.children) > 0 {
			symbol.Children = materializeHeadingSymbols(node.children)
		}
		symbols = append(symbols, symbol)
	}
	return symbols
}

func emptySymbolResult(revision transient.Revision) SymbolResult {
	return SymbolResult{Revision: revision, Symbols: []protocol.DocumentSymbol{}}
}
