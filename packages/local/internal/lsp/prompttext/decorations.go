package prompttext

import (
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

func headingDecorations(template staticprotocol.PromptTextTemplate) []Decoration {
	decorations := make([]Decoration, 0, len(template.Blocks))
	for _, block := range template.Blocks {
		heading, ok := block.Heading()
		if !ok {
			continue
		}
		decorations = append(decorations, Decoration{
			Role:  DecorationRoleHeading,
			Range: editorRange(heading.TextRange),
		})
	}
	return decorations
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
