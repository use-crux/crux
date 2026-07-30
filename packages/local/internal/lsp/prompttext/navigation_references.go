package prompttext

import (
	"sort"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func navigationReferences(
	view *promptview.View,
	refs []promptview.PromptTextSourceRef,
	owners []string,
	includeDeclaration bool,
) []protocol.Location {
	if targets, ok := namedFragmentTargets(view, refs); ok {
		return finalizeNavigationItems(fragmentReferenceItems(view, targets), includeDeclaration)
	}
	if len(owners) != 1 {
		return []protocol.Location{}
	}
	return finalizeNavigationItems(ownerReferenceItems(view, owners[0]), includeDeclaration)
}

func namedFragmentTargets(
	view *promptview.View,
	refs []promptview.PromptTextSourceRef,
) ([]promptview.PromptTextSourceRef, bool) {
	if len(refs) == 0 ||
		refs[0].SourceKind != promptview.PromptTextSourceNamedFragment {
		return nil, false
	}
	first := refs[0]
	for _, ref := range refs[1:] {
		if ref.SourceKind != promptview.PromptTextSourceNamedFragment ||
			ref.Symbol != first.Symbol ||
			ref.Role != first.Role || ref.Property != first.Property ||
			ref.Lifecycle != first.Lifecycle || ref.Template != first.Template {
			return nil, false
		}
	}
	joined := false
	for _, join := range view.FragmentJoins {
		for _, ref := range refs {
			if join.Key.DefinitionID == ref.Key.DefinitionID &&
				join.Key.TargetSourceRefID == ref.Key.SourceRefID &&
				join.TargetTemplate == ref.Template {
				joined = true
			}
		}
	}
	return refs, joined
}

func fragmentReferenceItems(
	view *promptview.View,
	targets []promptview.PromptTextSourceRef,
) []navigationItem {
	target := targets[0]
	result := []navigationItem{{
		location:    protocolLocation(target.Template),
		stableID:    target.Key.DefinitionID + ":" + target.Key.SourceRefID,
		declaration: true,
	}}
	for _, join := range view.FragmentJoins {
		for _, candidate := range targets {
			if join.Key.DefinitionID != candidate.Key.DefinitionID ||
				join.Key.TargetSourceRefID != candidate.Key.SourceRefID ||
				join.TargetTemplate != candidate.Template {
				continue
			}
			result = append(result, navigationItem{
				location: protocolLocation(join.Expression),
				stableID: join.Key.DefinitionID + ":" + join.Key.OwnerSourceRefID,
			})
			break
		}
	}
	return result
}

func ownerReferenceItems(
	view *promptview.View,
	definitionID string,
) []navigationItem {
	result := make([]navigationItem, 0)
	promptTextSiteIDs := make(map[string]struct{})
	if definition, ok := definitionByID(view, definitionID); ok {
		result = append(result, navigationItem{
			location: protocolLocation(definition.Location),
			stableID: definition.ID, declaration: true,
		})
	}
	for _, ref := range view.PromptTextRefs {
		if ref.Key.DefinitionID == definitionID {
			promptTextSiteIDs[ref.Key.SourceRefID] = struct{}{}
			result = append(result, navigationItem{
				location: protocolLocation(ref.Template),
				stableID: ref.Key.SourceRefID,
			})
		}
	}
	for _, site := range view.Sites {
		if site.TargetDefinitionID != definitionID {
			continue
		}
		if _, promptTextDuplicate := promptTextSiteIDs[site.ID]; promptTextDuplicate {
			continue
		}
		location := protocolLocation(site.Location)
		location.Range = protocol.Range{
			Start: protocol.Position{Line: location.Range.Start.Line},
			End:   protocol.Position{Line: location.Range.Start.Line + 1},
		}
		result = append(result, navigationItem{
			location: location, stableID: site.ID,
		})
	}
	return result
}

func finalizeNavigationItems(
	items []navigationItem,
	includeDeclaration bool,
) []protocol.Location {
	declarations := make([]navigationItem, 0, 1)
	references := make([]navigationItem, 0, len(items))
	seen := make(map[protocol.Location]struct{})
	for _, item := range items {
		if _, duplicate := seen[item.location]; duplicate {
			continue
		}
		seen[item.location] = struct{}{}
		if item.declaration {
			declarations = append(declarations, item)
		} else {
			references = append(references, item)
		}
	}
	sortNavigationItems(declarations)
	sortNavigationItems(references)
	result := make([]protocol.Location, 0, len(items))
	if includeDeclaration && len(declarations) > 0 {
		result = append(result, declarations[0].location)
	}
	for _, item := range references {
		result = append(result, item.location)
	}
	return result
}

func sortNavigationItems(items []navigationItem) {
	sort.Slice(items, func(i, j int) bool {
		left, right := items[i], items[j]
		if left.location.URI != right.location.URI {
			return left.location.URI < right.location.URI
		}
		if comparison := compareEditorPosition(
			left.location.Range.Start,
			right.location.Range.Start,
		); comparison != 0 {
			return comparison < 0
		}
		if comparison := compareEditorPosition(
			left.location.Range.End,
			right.location.Range.End,
		); comparison != 0 {
			return comparison < 0
		}
		return left.stableID < right.stableID
	})
}
