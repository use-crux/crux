package readmodel

import (
	"reflect"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func definitionsByID(definitions []api.ProjectDefinition) map[string]api.ProjectDefinition {
	result := make(map[string]api.ProjectDefinition, len(definitions))
	for _, definition := range definitions {
		result[definition.ID] = cloneDefinition(definition)
	}
	return result
}

func applyDefinitionChanges(definitions map[string]api.ProjectDefinition, changes DefinitionChanges) bool {
	changed := false
	for _, id := range changes.RemovedIDs {
		if _, ok := definitions[id]; ok {
			delete(definitions, id)
			changed = true
		}
	}
	for _, definition := range changes.Added {
		changed = upsertDefinition(definitions, definition) || changed
	}
	for _, definition := range changes.Changed {
		changed = upsertDefinition(definitions, definition) || changed
	}
	return changed
}

func upsertDefinition(definitions map[string]api.ProjectDefinition, definition api.ProjectDefinition) bool {
	if previous, ok := definitions[definition.ID]; !ok || !reflect.DeepEqual(previous, definition) {
		definitions[definition.ID] = cloneDefinition(definition)
		return true
	}
	return false
}

func definitionAffectedAnchors(
	current *scopeState,
	nextAnchors map[string][]api.IndexLintFinding,
	nextDefinitions map[string]api.ProjectDefinition,
) []string {
	changedIDs := make(map[string]struct{})
	for id, definition := range current.definitions {
		if !reflect.DeepEqual(definition, nextDefinitions[id]) {
			changedIDs[id] = struct{}{}
		}
	}
	for id, definition := range nextDefinitions {
		if !reflect.DeepEqual(definition, current.definitions[id]) {
			changedIDs[id] = struct{}{}
		}
	}
	files := make([]string, 0)
	for file, findings := range nextAnchors {
		for _, finding := range findings {
			if _, ok := changedIDs[finding.PrimaryDefinitionID]; ok {
				files = append(files, file)
				break
			}
		}
	}
	return files
}

func cloneDefinition(definition api.ProjectDefinition) api.ProjectDefinition {
	result := definition
	result.Tags = append([]string(nil), definition.Tags...)
	result.Path = append([]string(nil), definition.Path...)
	result.Metadata = append([]byte(nil), definition.Metadata...)
	result.Source = cloneSource(definition.Source)
	result.SourceSnippet = cloneSourceSnippet(definition.SourceSnippet)
	result.SourceRefs = make([]api.ProjectSourceRef, len(definition.SourceRefs))
	for index, sourceRef := range definition.SourceRefs {
		result.SourceRefs[index] = sourceRef
		result.SourceRefs[index].Source = *cloneSource(&sourceRef.Source)
		result.SourceRefs[index].Snippet = cloneSourceSnippet(sourceRef.Snippet)
		result.SourceRefs[index].Metadata = cloneMetadata(sourceRef.Metadata)
	}
	return result
}

func cloneSourceSnippet(source *api.SourceSnippet) *api.SourceSnippet {
	if source == nil {
		return nil
	}
	result := *source
	result.Range = cloneSourceRange(source.Range)
	return &result
}

func cloneMetadata(source map[string]any) map[string]any {
	if source == nil {
		return nil
	}
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = cloneMetadataValue(value)
	}
	return result
}

func cloneMetadataValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		return cloneMetadata(value)
	case []any:
		result := make([]any, len(value))
		for index := range value {
			result[index] = cloneMetadataValue(value[index])
		}
		return result
	case []string:
		return append([]string(nil), value...)
	case []byte:
		return append([]byte(nil), value...)
	default:
		return value
	}
}

func cloneSourceRange(source api.SourceRange) api.SourceRange {
	result := source
	if source.EndLine != nil {
		value := *source.EndLine
		result.EndLine = &value
	}
	if source.StartColumn != nil {
		value := *source.StartColumn
		result.StartColumn = &value
	}
	if source.EndColumn != nil {
		value := *source.EndColumn
		result.EndColumn = &value
	}
	return result
}

func compactStrings(values []string) []string {
	if len(values) < 2 {
		return values
	}
	result := values[:1]
	for _, value := range values[1:] {
		if value != result[len(result)-1] {
			result = append(result, value)
		}
	}
	return result
}
