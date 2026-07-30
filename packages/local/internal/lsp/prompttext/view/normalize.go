package view

import (
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

type normalizedView struct {
	View
	definitionSignatures map[string]string
	siteSignatures       map[string]string
	refSignatures        map[SourceRefKey]string
	joinSignatures       map[FragmentJoinKey]string
	refactorSignatures   map[SourceRefKey]string
}

func normalizePublication(publication readmodel.Publication, root string) normalizedView {
	result := normalizedView{
		definitionSignatures: make(map[string]string),
		siteSignatures:       make(map[string]string),
		refSignatures:        make(map[SourceRefKey]string),
		joinSignatures:       make(map[FragmentJoinKey]string),
		refactorSignatures:   make(map[SourceRefKey]string),
	}
	counts := relationCounts(publication.Relations)
	for _, raw := range publication.DefinitionsByID {
		definition, ok := normalizeDefinition(raw, root, counts[raw.ID])
		if !ok {
			continue
		}
		result.Definitions = append(result.Definitions, definition)
		result.definitionSignatures[definition.ID] = definitionSignature(definition)
		refs, joins, refactors := normalizeSourceRefs(raw, root)
		result.PromptTextRefs = append(result.PromptTextRefs, refs...)
		result.FragmentJoins = append(result.FragmentJoins, joins...)
		result.RefactorTargets = append(result.RefactorTargets, refactors...)
	}
	for _, sites := range publication.SitesByFile {
		for _, raw := range sites {
			site, ok := normalizeSite(raw, root)
			if !ok {
				continue
			}
			result.Sites = append(result.Sites, site)
			result.siteSignatures[site.ID] = siteSignature(site)
		}
	}
	invalidateDuplicateRecords(&result)
	attachDefinitionRefs(&result)
	sortNormalizedView(&result.View)
	return result
}

func normalizeDefinition(
	raw api.ProjectDefinition,
	root string,
	count definitionCounts,
) (Definition, bool) {
	location, ok := definitionLocation(raw, root)
	if raw.ID == "" || !ok {
		return Definition{}, false
	}
	return Definition{
		ID: raw.ID, Kind: raw.Kind, Name: raw.Name, Description: raw.Description,
		Location: location, IncomingRelations: count.incoming,
		OutgoingRelations: count.outgoing,
	}, true
}

func normalizeSite(raw readmodel.NavigationSite, root string) (Site, bool) {
	location, ok := sourceLocation(raw.Source, root)
	if raw.ID == "" || raw.TargetDefinitionID == "" || !ok {
		return Site{}, false
	}
	return Site{
		ID: raw.ID, TargetDefinitionID: raw.TargetDefinitionID,
		Role: raw.Role, Location: location,
	}, true
}

func definitionLocation(raw api.ProjectDefinition, root string) (Location, bool) {
	if raw.SourceSnippet != nil {
		if location, ok := sourceRangeLocation(raw.SourceSnippet.Range, root); ok {
			return location, true
		}
	}
	if raw.Source == nil {
		return Location{}, false
	}
	return sourceLocation(*raw.Source, root)
}

func sourceLocation(source api.SourceLoc, root string) (Location, bool) {
	if source.File == "" || source.Line < 1 {
		return Location{}, false
	}
	start := protocol.Position{Line: uint32(source.Line - 1)}
	if source.Column == nil {
		return Location{
			File: canonicalFile(root, source.File),
			Range: protocol.Range{
				Start: start,
				End:   protocol.Position{Line: start.Line + 1},
			},
		}, true
	}
	if *source.Column < 1 {
		return Location{}, false
	}
	start.Character = uint32(*source.Column - 1)
	return Location{
		File:  canonicalFile(root, source.File),
		Range: protocol.Range{Start: start, End: start},
	}, true
}

func sourceRangeLocation(source api.SourceRange, root string) (Location, bool) {
	if source.File == "" || source.StartLine < 1 || source.StartColumn == nil ||
		source.EndLine == nil || source.EndColumn == nil ||
		*source.StartColumn < 1 || *source.EndLine < 1 || *source.EndColumn < 1 {
		return Location{}, false
	}
	location := Location{
		File: canonicalFile(root, source.File),
		Range: protocol.Range{
			Start: protocol.Position{
				Line: uint32(source.StartLine - 1), Character: uint32(*source.StartColumn - 1),
			},
			End: protocol.Position{
				Line: uint32(*source.EndLine - 1), Character: uint32(*source.EndColumn - 1),
			},
		},
	}
	return location, comparePosition(location.Range.Start, location.Range.End) <= 0
}

func canonicalFile(root, file string) string {
	if filepath.IsAbs(file) {
		return filepath.Clean(file)
	}
	return filepath.Clean(filepath.Join(root, file))
}

type definitionCounts struct{ incoming, outgoing int }

func relationCounts(relations []api.ProjectRelation) map[string]definitionCounts {
	result := make(map[string]definitionCounts)
	for _, relation := range relations {
		from, to := result[relation.From], result[relation.To]
		from.outgoing++
		to.incoming++
		result[relation.From], result[relation.To] = from, to
	}
	return result
}

func definitionSignature(value Definition) string {
	return strings.Join([]string{
		value.Kind, value.Name, value.Description,
		strconv.Itoa(value.IncomingRelations), strconv.Itoa(value.OutgoingRelations),
	}, "\x00")
}

func siteSignature(value Site) string {
	return strings.Join([]string{value.TargetDefinitionID, value.Role}, "\x00")
}

func sortNormalizedView(result *View) {
	sort.Slice(result.Definitions, func(i, j int) bool {
		return result.Definitions[i].ID < result.Definitions[j].ID
	})
	sort.Slice(result.Sites, func(i, j int) bool {
		left, right := result.Sites[i], result.Sites[j]
		return locationKey(left.Location, left.ID) < locationKey(right.Location, right.ID)
	})
	sort.Slice(result.PromptTextRefs, func(i, j int) bool {
		left, right := result.PromptTextRefs[i], result.PromptTextRefs[j]
		return locationKey(left.Template, sourceRefKey(left.Key)) <
			locationKey(right.Template, sourceRefKey(right.Key))
	})
	sort.Slice(result.FragmentJoins, func(i, j int) bool {
		left, right := result.FragmentJoins[i], result.FragmentJoins[j]
		return locationKey(left.Expression, fragmentJoinKey(left.Key)) <
			locationKey(right.Expression, fragmentJoinKey(right.Key))
	})
	sort.Slice(result.RefactorTargets, func(i, j int) bool {
		left, right := result.RefactorTargets[i], result.RefactorTargets[j]
		return locationKey(left.Expression, sourceRefKey(left.Key)) <
			locationKey(right.Expression, sourceRefKey(right.Key))
	})
}

func locationKey(location Location, suffix string) string {
	return location.File + "\x00" + rangeKey(location.Range) + "\x00" + suffix
}

func rangeKey(value protocol.Range) string {
	return strconv.FormatUint(uint64(value.Start.Line), 10) + ":" +
		strconv.FormatUint(uint64(value.Start.Character), 10) + ":" +
		strconv.FormatUint(uint64(value.End.Line), 10) + ":" +
		strconv.FormatUint(uint64(value.End.Character), 10)
}

func sourceRefKey(value SourceRefKey) string {
	return value.DefinitionID + "\x00" + value.SourceRefID
}

func fragmentJoinKey(value FragmentJoinKey) string {
	return value.DefinitionID + "\x00" + value.OwnerSourceRefID + "\x00" +
		strconv.FormatUint(uint64(value.InterpolationIndex), 10) + "\x00" +
		value.TargetSourceRefID
}
