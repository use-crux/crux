package view

import (
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func recordsInFile(view normalizedView, file string) map[string]trackedRange {
	result := make(map[string]trackedRange)
	for _, value := range view.Definitions {
		addTrackedLocation(result, "definition:"+value.ID, view.definitionSignatures[value.ID], value.Location, file)
	}
	for _, value := range view.Sites {
		addTrackedLocation(result, "site:"+value.ID, view.siteSignatures[value.ID], value.Location, file)
	}
	for _, value := range view.PromptTextRefs {
		key := "ref:" + sourceRefKey(value.Key)
		addTrackedLocation(result, key, view.refSignatures[value.Key], value.Template, file)
	}
	for _, value := range view.FragmentJoins {
		key := "join:" + fragmentJoinKey(value.Key)
		signature := view.joinSignatures[value.Key]
		addTrackedLocation(result, key+":owner", signature, value.OwnerTemplate, file)
		addTrackedLocation(result, key+":expression", signature, value.Expression, file)
		addTrackedLocation(result, key+":target", signature, value.TargetTemplate, file)
	}
	for _, value := range view.RefactorTargets {
		key := "refactor:" + sourceRefKey(value.Key)
		addTrackedLocation(result, key, view.refactorSignatures[value.Key], value.Expression, file)
	}
	return result
}

func addTrackedLocation(
	records map[string]trackedRange,
	key string,
	signature string,
	location Location,
	file string,
) {
	if location.File != file {
		return
	}
	records[key] = trackedRange{
		signature: signature, ranges: []protocol.Range{location.Range}, valid: true,
	}
}

func transformedView(
	selected normalizedView,
	snapshot transformSnapshot,
	sourceHashes map[string]selectedSourceHash,
) View {
	result := selected.View
	result.Documents = snapshot.documentStamps()
	result.Definitions = transformDefinitions(selected, snapshot, sourceHashes)
	result.Sites = transformSites(selected, snapshot, sourceHashes)
	result.PromptTextRefs = transformRefs(selected, snapshot, sourceHashes)
	result.FragmentJoins = transformJoins(selected, snapshot, sourceHashes)
	result.RefactorTargets = transformRefactors(selected, snapshot, sourceHashes)
	attachTransformedDefinitionRefs(&result)
	sortNormalizedView(&result)
	return result
}

func transformDefinitions(
	selected normalizedView,
	snapshot transformSnapshot,
	hashes map[string]selectedSourceHash,
) []Definition {
	result := make([]Definition, 0, len(selected.Definitions))
	for _, value := range selected.Definitions {
		location, ok := transformLocation(
			value.Location, "definition:"+value.ID,
			selected.definitionSignatures[value.ID], snapshot, hashes,
		)
		if ok {
			value.Location = location
			result = append(result, value)
		}
	}
	return result
}

func transformSites(
	selected normalizedView,
	snapshot transformSnapshot,
	hashes map[string]selectedSourceHash,
) []Site {
	result := make([]Site, 0, len(selected.Sites))
	for _, value := range selected.Sites {
		location, ok := transformLocation(
			value.Location, "site:"+value.ID,
			selected.siteSignatures[value.ID], snapshot, hashes,
		)
		if ok {
			value.Location = location
			result = append(result, value)
		}
	}
	return result
}

func transformRefs(
	selected normalizedView,
	snapshot transformSnapshot,
	hashes map[string]selectedSourceHash,
) []PromptTextSourceRef {
	result := make([]PromptTextSourceRef, 0, len(selected.PromptTextRefs))
	for _, value := range selected.PromptTextRefs {
		location, ok := transformLocation(
			value.Template, "ref:"+sourceRefKey(value.Key),
			selected.refSignatures[value.Key], snapshot, hashes,
		)
		if ok {
			value.Template = location
			result = append(result, value)
		}
	}
	return result
}

func transformJoins(
	selected normalizedView,
	snapshot transformSnapshot,
	hashes map[string]selectedSourceHash,
) []FragmentJoin {
	result := make([]FragmentJoin, 0, len(selected.FragmentJoins))
	for _, value := range selected.FragmentJoins {
		key := "join:" + fragmentJoinKey(value.Key)
		signature := selected.joinSignatures[value.Key]
		owner, ownerOK := transformLocation(value.OwnerTemplate, key+":owner", signature, snapshot, hashes)
		expression, expressionOK := transformLocation(value.Expression, key+":expression", signature, snapshot, hashes)
		target, targetOK := transformLocation(value.TargetTemplate, key+":target", signature, snapshot, hashes)
		if ownerOK && expressionOK && targetOK {
			value.OwnerTemplate, value.Expression, value.TargetTemplate = owner, expression, target
			result = append(result, value)
		}
	}
	return result
}

func transformRefactors(
	selected normalizedView,
	snapshot transformSnapshot,
	hashes map[string]selectedSourceHash,
) []StringRefactorTarget {
	result := make([]StringRefactorTarget, 0, len(selected.RefactorTargets))
	for _, value := range selected.RefactorTargets {
		location, ok := transformLocation(
			value.Expression, "refactor:"+sourceRefKey(value.Key),
			selected.refactorSignatures[value.Key], snapshot, hashes,
		)
		if ok {
			value.Expression = location
			result = append(result, value)
		}
	}
	return result
}

func transformLocation(
	location Location,
	key string,
	signature string,
	snapshot transformSnapshot,
	hashes map[string]selectedSourceHash,
) (Location, bool) {
	document, open := snapshot.documents[location.File]
	if !open {
		return location, true
	}
	if document.unavailable {
		return Location{}, false
	}
	selectedHash := hashes[location.File]
	if selectedHash.effective != "" &&
		document.revision.SourceHash == selectedHash.effective {
		return location, true
	}
	record, exists := document.records[key]
	if selectedHash.base == "" ||
		document.baseSourceHash != selectedHash.base ||
		!exists || !record.valid || record.signature != signature ||
		len(record.ranges) != 1 {
		return Location{}, false
	}
	location.Range = record.ranges[0]
	return location, true
}

func attachTransformedDefinitionRefs(result *View) {
	refs := make(map[string][]SourceRefKey)
	for _, ref := range result.PromptTextRefs {
		refs[ref.Key.DefinitionID] = append(refs[ref.Key.DefinitionID], ref.Key)
	}
	for index := range result.Definitions {
		result.Definitions[index].PromptTextSourceRefs =
			append([]SourceRefKey(nil), refs[result.Definitions[index].ID]...)
	}
}
