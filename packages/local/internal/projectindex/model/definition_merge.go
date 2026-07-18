package model

import (
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func MergeProjectDefinition(existing, incoming store.ProjectDefinition) store.ProjectDefinition {
	if fidelityRank(existing.Fidelity) > fidelityRank(incoming.Fidelity) {
		incoming.Fidelity = existing.Fidelity
	}
	if incoming.Status == "" {
		incoming.Status = existing.Status
	}
	if incoming.Source == nil {
		incoming.Source = existing.Source
	}
	if incoming.SourceSnippet == nil {
		incoming.SourceSnippet = existing.SourceSnippet
	}
	if len(incoming.SourceRefs) == 0 {
		incoming.SourceRefs = existing.SourceRefs
	}
	if incoming.Description == "" {
		incoming.Description = existing.Description
	}
	if len(incoming.Tags) == 0 {
		incoming.Tags = existing.Tags
	}
	if len(incoming.Path) == 0 {
		incoming.Path = existing.Path
	}
	if incoming.Fingerprint == "" {
		incoming.Fingerprint = existing.Fingerprint
	}
	if incoming.Metadata == nil {
		incoming.Metadata = existing.Metadata
	} else if existing.Metadata != nil {
		incoming.Metadata = mergeMetadataRaw(existing.Metadata, incoming.Metadata)
	}
	return incoming
}

func mergeProjectDefinition(existing, incoming store.ProjectDefinition) store.ProjectDefinition {
	return MergeProjectDefinition(existing, incoming)
}

func fidelityRank(fidelity string) int {
	switch fidelity {
	case "resolved":
		return 3
	case "partial":
		return 2
	case "error":
		return 1
	default:
		return 0
	}
}

func mergeMetadataRaw(existing, incoming json.RawMessage) json.RawMessage {
	var existingMap map[string]any
	var incomingMap map[string]any
	if err := json.Unmarshal(existing, &existingMap); err != nil || existingMap == nil {
		return incoming
	}
	if err := json.Unmarshal(incoming, &incomingMap); err != nil || incomingMap == nil {
		return incoming
	}
	merged := map[string]any{}
	for key, value := range existingMap {
		merged[key] = value
	}
	for key, value := range incomingMap {
		merged[key] = value
	}
	merged = mergeDefinitionFactsMetadata(existingMap, incomingMap, merged)
	data, err := json.Marshal(merged)
	if err != nil {
		return incoming
	}
	return data
}

func mergeDefinitionFactsMetadata(existingMap, incomingMap, merged map[string]any) map[string]any {
	existingFacts, existingOK := existingMap["facts"].(map[string]any)
	incomingFacts, incomingOK := incomingMap["facts"].(map[string]any)
	if !existingOK && !incomingOK {
		return merged
	}
	facts := map[string]any{}
	for key, value := range existingFacts {
		facts[key] = value
	}
	for key, value := range incomingFacts {
		facts[key] = value
	}
	useEntries := appendJSONLists(existingFacts["useEntries"], incomingFacts["useEntries"])
	if len(useEntries) > 0 {
		facts["useEntries"] = useEntries
	}
	merged["facts"] = facts
	return merged
}

func appendJSONLists(existing, incoming any) []any {
	out := []any{}
	if list, ok := existing.([]any); ok {
		out = append(out, list...)
	}
	if list, ok := incoming.([]any); ok {
		out = append(out, list...)
	}
	return dedupeJSONList(out)
}

func dedupeJSONList(items []any) []any {
	seen := map[string]bool{}
	out := make([]any, 0, len(items))
	for _, item := range items {
		data, err := json.Marshal(item)
		key := string(data)
		if err != nil {
			key = fmt.Sprintf("%#v", item)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}
