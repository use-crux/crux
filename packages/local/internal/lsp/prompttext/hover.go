package prompttext

import (
	"sort"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// PromptTextHover contains only bounded facts from one coherent transformed
// semantic view and its exact current syntax match.
type PromptTextHover struct {
	Handled           bool
	Claimed           bool
	Range             protocol.Range
	Owners            []promptview.Definition
	TemplateLabel     string
	Lifecycle         string
	LiteralCount      int
	BarrierCount      int
	OutgoingFragments int
	IncomingFragments int
	Evidence          string
}

func promptTextHoverAt(
	view *promptview.View,
	analysis staticprotocol.PromptTextQueryResponse,
	file string,
	position protocol.Position,
	status indexview.ViewStatus,
) PromptTextHover {
	refs := refsAt(view, file, position)
	if len(refs) == 0 {
		return PromptTextHover{}
	}
	empty := PromptTextHover{Handled: true}
	if analysis.Status.Kind != staticprotocol.PromptTextStatusComplete {
		return empty
	}
	template, ok := uniqueSyntaxTemplate(analysis.Templates, refs[0].Template.Range)
	if !ok || !sameTemplateRange(refs) || !claimsPromptTextPosition(template, position) {
		return empty
	}
	label, lifecycle, consistent := promptTextTemplateLabel(refs)
	if !consistent {
		return empty
	}
	ownerIDs := occurrenceOwners(view, refs)
	owners := hoverOwners(view, ownerIDs)
	if len(owners) == 0 || len(owners) != len(ownerIDs) {
		return empty
	}
	outgoing, incoming := fragmentCounts(view, refs)
	return PromptTextHover{
		Handled: true, Claimed: true, Range: smallestHoverRange(template, position),
		Owners: owners, TemplateLabel: label, Lifecycle: lifecycle,
		LiteralCount: len(template.LiteralIslands), BarrierCount: len(template.InterpolationBarriers),
		OutgoingFragments: outgoing, IncomingFragments: incoming,
		Evidence: promptTextEvidenceLabel(status),
	}
}

func promptTextTemplateLabel(
	refs []promptview.PromptTextSourceRef,
) (string, string, bool) {
	if len(refs) == 0 {
		return "", "", false
	}
	first := refs[0]
	for _, ref := range refs[1:] {
		if ref.Role != first.Role || ref.Property != first.Property ||
			ref.Symbol != first.Symbol || ref.Lifecycle != first.Lifecycle ||
			ref.SourceKind != first.SourceKind {
			return "", "", false
		}
	}
	switch first.SourceKind {
	case promptview.PromptTextSourceNamedFragment:
		return "named fragment `" + first.Symbol + "`", first.Lifecycle, true
	case promptview.PromptTextSourceAnonymousFragment:
		return "anonymous fragment", first.Lifecycle, true
	case promptview.PromptTextSourceOwner:
		switch first.Property {
		case "prompt":
			return "direct `prompt` template", first.Lifecycle, true
		case "system":
			return "direct `system` template", first.Lifecycle, true
		default:
			return "", "", false
		}
	default:
		return "", "", false
	}
}

func hoverOwners(
	view *promptview.View,
	ids []string,
) []promptview.Definition {
	result := make([]promptview.Definition, 0, len(ids))
	for _, id := range ids {
		if definition, ok := definitionByID(view, id); ok {
			result = append(result, definition)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func fragmentCounts(
	view *promptview.View,
	refs []promptview.PromptTextSourceRef,
) (int, int) {
	keys := make(map[promptview.SourceRefKey]struct{}, len(refs))
	for _, ref := range refs {
		keys[ref.Key] = struct{}{}
	}
	var outgoing, incoming int
	for _, join := range view.FragmentJoins {
		owner := promptview.SourceRefKey{
			DefinitionID: join.Key.DefinitionID,
			SourceRefID:  join.Key.OwnerSourceRefID,
		}
		target := promptview.SourceRefKey{
			DefinitionID: join.Key.DefinitionID,
			SourceRefID:  join.Key.TargetSourceRefID,
		}
		if _, ok := keys[owner]; ok {
			outgoing++
		}
		if _, ok := keys[target]; ok {
			incoming++
		}
	}
	return outgoing, incoming
}

func promptTextEvidenceLabel(status indexview.ViewStatus) string {
	if status == indexview.ViewStatusExact {
		return "exact semantic view"
	}
	return "saved semantic fallback; current syntax matched"
}

type hoverRangeCandidate struct {
	source protocol.Range
	rank   int
}

func smallestHoverRange(
	template staticprotocol.PromptTextTemplate,
	position protocol.Position,
) protocol.Range {
	candidates := make([]hoverRangeCandidate, 0)
	for _, link := range template.Links {
		candidates = appendHoverCandidate(candidates, editorRange(link.Range), position, 0)
	}
	for _, span := range template.Spans {
		candidates = appendHoverCandidate(candidates, editorRange(span.Range), position, 1)
	}
	for _, block := range template.Blocks {
		candidates = appendHoverCandidate(candidates, editorRange(block.Range), position, 2)
	}
	for _, island := range template.LiteralIslands {
		candidates = appendHoverCandidate(candidates, editorRange(island.Range), position, 3)
	}
	for _, backtick := range template.BacktickRanges {
		candidates = appendHoverCandidate(candidates, editorRange(backtick), position, 4)
	}
	if len(candidates) == 0 {
		return protocol.Range{}
	}
	best := candidates[0]
	for _, candidate := range candidates[1:] {
		if rangeStrictlyContains(best.source, candidate.source) ||
			best.source == candidate.source && candidate.rank < best.rank {
			best = candidate
		}
	}
	return best.source
}

func appendHoverCandidate(
	values []hoverRangeCandidate,
	source protocol.Range,
	position protocol.Position,
	rank int,
) []hoverRangeCandidate {
	if containsPosition(source, position) {
		return append(values, hoverRangeCandidate{source: source, rank: rank})
	}
	return values
}

func rangeStrictlyContains(outer, inner protocol.Range) bool {
	return outer != inner &&
		compareEditorPosition(outer.Start, inner.Start) <= 0 &&
		compareEditorPosition(inner.End, outer.End) <= 0
}
