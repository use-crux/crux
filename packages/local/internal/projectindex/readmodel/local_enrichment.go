package readmodel

import (
	"encoding/json"
	"io/fs"
	"path/filepath"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func enrichDefinitionUpdated(index store.IndexData, stat statFunc) store.IndexData {
	if len(index.Definitions) == 0 {
		return index
	}
	root := ""
	if index.Project != nil {
		root = index.Project.Root
	}
	definitions := make([]store.ProjectDefinition, len(index.Definitions))
	copy(definitions, index.Definitions)
	for i := range definitions {
		source := definitions[i].Source
		if source == nil || source.File == "" {
			continue
		}
		sourceFile := source.File
		if !filepath.IsAbs(sourceFile) && root != "" {
			sourceFile = filepath.Join(root, sourceFile)
		}
		info, err := statFile(stat, sourceFile)
		if err != nil || info.IsDir() {
			continue
		}
		definitions[i].Metadata = mergeMetadataRaw(definitions[i].Metadata, mustMarshalJSON(map[string]any{
			"updated": map[string]any{
				"lastEditedAt":   info.ModTime().UTC().Format(time.RFC3339Nano),
				"lastEditedAtMs": info.ModTime().UnixMilli(),
				"sourceMtime":    true,
			},
		}))
	}
	index.Definitions = definitions
	return index
}

func statFile(stat statFunc, path string) (fs.FileInfo, error) {
	if stat == nil {
		return nil, fs.ErrInvalid
	}
	return stat(path)
}

func enrichSafetyTargets(index store.IndexData) store.IndexData {
	if len(index.Definitions) == 0 || len(index.Relations) == 0 {
		return index
	}
	targetsBySafetyID := map[string][]string{}
	for _, relation := range index.Relations {
		if relation.Type != "constraint.applies_to" && relation.Type != "guardrail.applies_to" {
			continue
		}
		if relation.From == "" || relation.To == "" {
			continue
		}
		targetsBySafetyID[relation.From] = appendUniqueString(targetsBySafetyID[relation.From], relation.To)
	}
	if len(targetsBySafetyID) == 0 {
		return index
	}
	definitions := make([]store.ProjectDefinition, len(index.Definitions))
	copy(definitions, index.Definitions)
	for i := range definitions {
		targets := targetsBySafetyID[definitions[i].ID]
		if len(targets) == 0 {
			continue
		}
		metadata := rawMap(definitions[i].Metadata)
		facts := rawMapAny(metadata["facts"])
		if len(facts) == 0 {
			facts = map[string]any{"kind": definitions[i].Kind}
		}
		facts["appliesTo"] = targets
		metadata["appliesTo"] = targets
		metadata["facts"] = facts
		definitions[i].Metadata = mustMarshalJSON(metadata)
	}
	index.Definitions = definitions
	return index
}

func rawMap(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil || data == nil {
		return map[string]any{}
	}
	return data
}

func rawMapAny(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if existing, ok := value.(map[string]any); ok && existing != nil {
		return existing
	}
	return map[string]any{}
}

func mustMarshalJSON(value any) json.RawMessage {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return raw
}

func mergeMetadataRaw(existing, incoming json.RawMessage) json.RawMessage {
	base := rawMap(existing)
	overlay := rawMap(incoming)
	for key, value := range overlay {
		base[key] = value
	}
	if len(base) == 0 {
		return nil
	}
	return mustMarshalJSON(base)
}
