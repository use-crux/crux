package server

import "github.com/use-crux/crux/packages/local/internal/api"

func countDefinitionRelations(
	definitions []documentDefinition,
	relations []api.ProjectRelation,
) map[string]definitionRelationCount {
	if len(definitions) == 0 || len(relations) == 0 {
		return nil
	}
	result := make(map[string]definitionRelationCount, len(definitions))
	for _, definition := range definitions {
		result[definition.Definition.ID] = definitionRelationCount{}
	}
	for _, relation := range relations {
		if count, ok := result[relation.To]; ok {
			count.Incoming++
			result[relation.To] = count
		}
		if count, ok := result[relation.From]; ok {
			count.Outgoing++
			result[relation.From] = count
		}
	}
	return result
}

func cloneDefinitionRelationCounts(
	counts map[string]definitionRelationCount,
) map[string]definitionRelationCount {
	if len(counts) == 0 {
		return nil
	}
	result := make(map[string]definitionRelationCount, len(counts))
	for id, count := range counts {
		result[id] = count
	}
	return result
}
