package view

func invalidateDuplicateRecords(result *normalizedView) {
	result.Definitions = uniqueDefinitions(result.Definitions, result.definitionSignatures)
	result.Sites = uniqueSites(result.Sites, result.siteSignatures)
	result.PromptTextRefs = uniqueRefs(result.PromptTextRefs, result.refSignatures)
	result.FragmentJoins = uniqueJoins(
		result.FragmentJoins,
		result.joinSignatures,
		result.refSignatures,
	)
	result.FragmentJoins = noncyclicJoins(
		result.FragmentJoins,
		result.joinSignatures,
	)
	result.RefactorTargets = uniqueRefactors(result.RefactorTargets, result.refactorSignatures)
}

func uniqueDefinitions(
	values []Definition,
	signatures map[string]string,
) []Definition {
	counts := make(map[string]int, len(values))
	for _, value := range values {
		counts[value.ID]++
	}
	for id, count := range counts {
		if count != 1 {
			delete(signatures, id)
		}
	}
	result := values[:0]
	for _, value := range values {
		if counts[value.ID] == 1 {
			result = append(result, value)
			signatures[value.ID] = definitionSignature(value)
		}
	}
	return result
}

func uniqueSites(values []Site, signatures map[string]string) []Site {
	counts := make(map[string]int, len(values))
	for _, value := range values {
		counts[value.ID]++
	}
	for id, count := range counts {
		if count != 1 {
			delete(signatures, id)
		}
	}
	result := values[:0]
	for _, value := range values {
		if counts[value.ID] == 1 {
			result = append(result, value)
			signatures[value.ID] = siteSignature(value)
		}
	}
	return result
}

func uniqueRefs(
	values []PromptTextSourceRef,
	signatures map[SourceRefKey]string,
) []PromptTextSourceRef {
	counts := make(map[SourceRefKey]int, len(values))
	for _, value := range values {
		counts[value.Key]++
	}
	for key, count := range counts {
		if count != 1 {
			delete(signatures, key)
		}
	}
	result := values[:0]
	for _, value := range values {
		if counts[value.Key] == 1 {
			result = append(result, value)
			signatures[value.Key] = refSignature(value)
		}
	}
	return result
}

func uniqueJoins(
	values []FragmentJoin,
	signatures map[FragmentJoinKey]string,
	refSignatures map[SourceRefKey]string,
) []FragmentJoin {
	counts := make(map[FragmentJoinKey]int, len(values))
	for _, value := range values {
		counts[value.Key]++
	}
	for key, count := range counts {
		if count != 1 {
			delete(signatures, key)
		}
	}
	result := values[:0]
	for _, value := range values {
		ownerSignature, ownerOK := refSignatures[SourceRefKey{
			DefinitionID: value.Key.DefinitionID,
			SourceRefID:  value.Key.OwnerSourceRefID,
		}]
		targetSignature, targetOK := refSignatures[SourceRefKey{
			DefinitionID: value.Key.DefinitionID,
			SourceRefID:  value.Key.TargetSourceRefID,
		}]
		if counts[value.Key] == 1 && ownerOK && targetOK {
			result = append(result, value)
			signatures[value.Key] = joinSignature(value) + "\x00" +
				ownerSignature + "\x00" + targetSignature
		} else {
			delete(signatures, value.Key)
		}
	}
	return result
}

func uniqueRefactors(
	values []StringRefactorTarget,
	signatures map[SourceRefKey]string,
) []StringRefactorTarget {
	counts := make(map[SourceRefKey]int, len(values))
	for _, value := range values {
		counts[value.Key]++
	}
	for key, count := range counts {
		if count != 1 {
			delete(signatures, key)
		}
	}
	result := values[:0]
	for _, value := range values {
		if counts[value.Key] == 1 {
			result = append(result, value)
			signatures[value.Key] = refactorSignature(value)
		}
	}
	return result
}

func attachDefinitionRefs(result *normalizedView) {
	refs := make(map[string][]SourceRefKey)
	for _, ref := range result.PromptTextRefs {
		refs[ref.Key.DefinitionID] = append(refs[ref.Key.DefinitionID], ref.Key)
	}
	for index := range result.Definitions {
		keys := refs[result.Definitions[index].ID]
		result.Definitions[index].PromptTextSourceRefs =
			append([]SourceRefKey(nil), keys...)
	}
}
