package model

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type inputContribution struct {
	Field              string   `json:"field"`
	Schema             any      `json:"schema,omitempty"`
	Description        string   `json:"description,omitempty"`
	Required           bool     `json:"required,omitempty"`
	SourceDefinitionID string   `json:"sourceDefinitionId,omitempty"`
	SourceName         string   `json:"sourceName,omitempty"`
	SourceKind         string   `json:"sourceKind,omitempty"`
	Path               []string `json:"path,omitempty"`
	Via                string   `json:"via,omitempty"`
	Conditionality     string   `json:"conditionality,omitempty"`
	Branch             string   `json:"branch,omitempty"`
}

type inheritedInputEdge struct {
	Conditionality string
	Via            string
	Branch         string
}

func finalizeInjectionInputContracts(definitions []store.ProjectDefinition, relations []store.ProjectRelation) []store.ProjectDefinition {
	if len(definitions) == 0 {
		return nil
	}
	byID := map[string]store.ProjectDefinition{}
	outgoing := map[string][]store.ProjectRelation{}
	for _, definition := range definitions {
		byID[definition.ID] = definition
	}
	for _, relation := range relations {
		outgoing[relation.From] = append(outgoing[relation.From], relation)
	}

	next := make([]store.ProjectDefinition, len(definitions))
	for i, definition := range definitions {
		next[i] = definition
		if !canReceiveInjectedInput(definition.Kind) {
			continue
		}
		contributions := collectInputContributions(definition, byID, outgoing)
		next[i].Metadata = metadataWithEffectiveInputContract(definition.Metadata, contributions)
	}
	return next
}

func collectInputContributions(owner store.ProjectDefinition, byID map[string]store.ProjectDefinition, outgoing map[string][]store.ProjectRelation) []inputContribution {
	out := []inputContribution{}
	seenEdges := map[string]bool{}
	seenFields := map[string]bool{}

	var visit func(from store.ProjectDefinition, path []string, inherited inheritedInputEdge)
	visit = func(from store.ProjectDefinition, path []string, inherited inheritedInputEdge) {
		for _, relation := range outgoing[from.ID] {
			if !isInputInjectingRelation(relation.Type) || seenEdges[relation.ID] {
				continue
			}
			seenEdges[relation.ID] = true
			target, ok := byID[relation.To]
			if !ok || !canContributeInput(target.Kind) {
				continue
			}
			edgeFacts := useFactsForTarget(from, target)
			conditionality := combineInputConditionality(inherited.Conditionality, stringField(edgeFacts, "conditionality"))
			via := stringField(edgeFacts, "via")
			if via == "" {
				via = inherited.Via
			}
			branch := stringField(edgeFacts, "branch")
			if branch == "" {
				branch = inherited.Branch
			}
			nextPath := append(append([]string(nil), path...), target.ID)
			for _, contribution := range contributionsFromSchema(inputSchemaForDefinition(target), target, nextPath, inheritedInputEdge{
				Conditionality: conditionality,
				Via:            via,
				Branch:         branch,
			}) {
				key := contribution.Field + ":" + contribution.SourceDefinitionID + ":" + stringsJoin(contribution.Path, ">")
				if seenFields[key] {
					continue
				}
				seenFields[key] = true
				out = append(out, contribution)
			}
			visit(target, nextPath, inheritedInputEdge{Conditionality: conditionality, Via: via, Branch: branch})
		}
	}

	visit(owner, []string{owner.ID}, inheritedInputEdge{Conditionality: "always", Via: "direct"})
	return out
}

func contributionsFromSchema(schema any, source store.ProjectDefinition, path []string, edge inheritedInputEdge) []inputContribution {
	properties := schemaProperties(schema)
	if len(properties) == 0 {
		return nil
	}
	required := schemaRequiredFields(schema)
	out := make([]inputContribution, 0, len(properties))
	for field, fieldSchema := range properties {
		contribution := inputContribution{
			Field:              field,
			Schema:             fieldSchema,
			Required:           required[field] && edge.Conditionality == "always",
			SourceDefinitionID: source.ID,
			SourceName:         source.Name,
			SourceKind:         source.Kind,
			Path:               append([]string(nil), path...),
			Via:                edge.Via,
			Conditionality:     edge.Conditionality,
			Branch:             edge.Branch,
		}
		if fieldObject, ok := fieldSchema.(map[string]any); ok {
			if description, ok := fieldObject["description"].(string); ok {
				contribution.Description = description
			}
		}
		out = append(out, contribution)
	}
	return out
}

func metadataWithEffectiveInputContract(raw json.RawMessage, contributions []inputContribution) json.RawMessage {
	metadata := metadataObject(raw)
	if metadata == nil {
		if len(contributions) == 0 {
			return raw
		}
		metadata = map[string]any{}
	}
	if len(contributions) == 0 {
		return metadataWithoutEffectiveInputContract(raw, metadata)
	}
	intelligence := nestedObject(metadata, "intelligence")
	contract := nestedObject(intelligence, "contract")
	inputSchema := contract["inputSchema"]
	if inputSchema == nil {
		inputSchema = metadata["inputSchema"]
	}
	if inputSchema != nil {
		contract["inputSchema"] = inputSchema
	}

	contract["expandedInputSchema"] = mergeObjectSchemaContributions(inputSchema, contributions)
	contract["inputContributions"] = contributions
	if _, ok := intelligence["confidence"]; !ok {
		intelligence["confidence"] = "static"
	}
	metadata["intelligence"] = intelligence
	intelligence["contract"] = contract
	return marshalMetadata(metadata, raw)
}

func metadataWithoutEffectiveInputContract(raw json.RawMessage, metadata map[string]any) json.RawMessage {
	intelligence, ok := metadata["intelligence"].(map[string]any)
	if !ok {
		return raw
	}
	contract, ok := intelligence["contract"].(map[string]any)
	if !ok {
		return raw
	}
	if _, ok := contract["expandedInputSchema"]; !ok {
		if _, ok := contract["inputContributions"]; !ok {
			return raw
		}
	}
	delete(contract, "expandedInputSchema")
	delete(contract, "inputContributions")
	return marshalMetadata(metadata, raw)
}

func mergeObjectSchemaContributions(base any, contributions []inputContribution) map[string]any {
	expanded := cloneSchemaObject(base)
	if expanded == nil {
		expanded = map[string]any{"type": "object"}
	}
	if expanded["type"] == nil {
		expanded["type"] = "object"
	}
	properties := map[string]any{}
	for key, value := range schemaProperties(expanded) {
		properties[key] = value
	}
	required := schemaRequiredFields(expanded)
	for _, contribution := range contributions {
		if _, exists := properties[contribution.Field]; !exists && contribution.Schema != nil {
			properties[contribution.Field] = contribution.Schema
		}
		if contribution.Required {
			required[contribution.Field] = true
		}
	}
	expanded["properties"] = properties
	if len(required) > 0 {
		expanded["required"] = keysFromSet(required)
	}
	return expanded
}

func inputSchemaForDefinition(definition store.ProjectDefinition) any {
	metadata := metadataObject(definition.Metadata)
	if metadata == nil {
		return nil
	}
	if intelligence, ok := metadata["intelligence"].(map[string]any); ok {
		if contract, ok := intelligence["contract"].(map[string]any); ok {
			if schema := contract["inputSchema"]; schema != nil {
				return schema
			}
		}
	}
	return metadata["inputSchema"]
}

func useFactsForTarget(owner store.ProjectDefinition, target store.ProjectDefinition) map[string]any {
	metadata := metadataObject(owner.Metadata)
	if metadata == nil {
		return nil
	}
	facts, ok := metadata["facts"].(map[string]any)
	if !ok {
		return nil
	}
	entries, ok := facts["useEntries"].([]any)
	if !ok {
		return nil
	}
	for _, item := range entries {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		variable := stringField(entry, "variable")
		if variable == "" {
			continue
		}
		if variable == target.Name || variable == stringField(metadataObject(target.Metadata), "exportName") || hasDefinitionVariableSuffix(target.ID, variable) {
			return entry
		}
	}
	return nil
}

func metadataObject(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var metadata map[string]any
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil
	}
	return metadata
}

func nestedObject(parent map[string]any, key string) map[string]any {
	if object, ok := parent[key].(map[string]any); ok {
		return object
	}
	object := map[string]any{}
	parent[key] = object
	return object
}

func marshalMetadata(metadata map[string]any, fallback json.RawMessage) json.RawMessage {
	data, err := json.Marshal(metadata)
	if err != nil {
		return fallback
	}
	return data
}

func cloneSchemaObject(schema any) map[string]any {
	source, ok := schema.(map[string]any)
	if !ok {
		return nil
	}
	clone := map[string]any{}
	for key, value := range source {
		if key == "properties" {
			if properties, ok := value.(map[string]any); ok {
				copied := map[string]any{}
				for property, propertySchema := range properties {
					copied[property] = propertySchema
				}
				clone[key] = copied
				continue
			}
		}
		if key == "required" {
			if required, ok := value.([]any); ok {
				clone[key] = append([]any(nil), required...)
				continue
			}
		}
		clone[key] = value
	}
	return clone
}

func schemaProperties(schema any) map[string]any {
	object, ok := schema.(map[string]any)
	if !ok {
		return nil
	}
	properties, ok := object["properties"].(map[string]any)
	if !ok {
		return nil
	}
	return properties
}

func schemaRequiredFields(schema any) map[string]bool {
	object, ok := schema.(map[string]any)
	if !ok {
		return map[string]bool{}
	}
	list, ok := object["required"].([]any)
	if !ok {
		return map[string]bool{}
	}
	required := map[string]bool{}
	for _, item := range list {
		if field, ok := item.(string); ok {
			required[field] = true
		}
	}
	return required
}

func keysFromSet(set map[string]bool) []any {
	keys := make([]any, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	return keys
}

func combineInputConditionality(inherited string, current string) string {
	if inherited == "" || inherited == "always" {
		if current != "" {
			return current
		}
		if inherited != "" {
			return inherited
		}
		return "always"
	}
	return inherited
}

func canReceiveInjectedInput(kind string) bool {
	return kind == "prompt" || kind == "context" || kind == "injectable"
}

func canContributeInput(kind string) bool {
	return kind == "context" || kind == "injectable"
}

func isInputInjectingRelation(relationType string) bool {
	switch relationType {
	case "prompt.uses_context",
		"prompt.uses_injectable",
		"context.uses_context",
		"context.uses_injectable",
		"injectable.uses_context":
		return true
	default:
		return false
	}
}

func stringField(object map[string]any, key string) string {
	if object == nil {
		return ""
	}
	value, _ := object[key].(string)
	return value
}

func hasDefinitionVariableSuffix(definitionID string, variable string) bool {
	suffix := ":" + variable
	return len(definitionID) >= len(suffix) && definitionID[len(definitionID)-len(suffix):] == suffix
}

func stringsJoin(values []string, separator string) string {
	if len(values) == 0 {
		return ""
	}
	out := values[0]
	for _, value := range values[1:] {
		out += separator + value
	}
	return out
}
