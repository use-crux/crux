package model

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// Project overlays runtime definitions and relations onto an immutable base.
func (s *RuntimeOverlayState) Project(base store.IndexData) store.IndexData {
	projected := base
	projected.Definitions = append([]store.ProjectDefinition(nil), base.Definitions...)
	projected.Relations = append([]store.ProjectRelation(nil), base.Relations...)
	for _, overlay := range s.byOwner {
		projected.Definitions = mergeOverlayDefinitions(projected.Definitions, overlay.Definitions)
		projected.Definitions = projectRuntimeOwnerHealth(projected.Definitions, overlay)
		projected.Relations = mergeOverlayRelations(projected.Relations, overlay.Relations)
		projected.Diagnostics = mergeOverlayDiagnostics(projected.Diagnostics, overlay.Diagnostics)
	}
	return projected
}

func mergeOverlayDefinitions(base, overlay []store.ProjectDefinition) []store.ProjectDefinition {
	next := append([]store.ProjectDefinition(nil), base...)
	byID := map[string]int{}
	for index, definition := range next {
		byID[definition.ID] = index
	}
	for _, definition := range overlay {
		if index, ok := byID[definition.ID]; ok {
			next[index] = MergeProjectDefinition(next[index], definition)
			continue
		}
		byID[definition.ID] = len(next)
		next = append(next, definition)
	}
	return next
}

func mergeOverlayRelations(base, overlay []store.ProjectRelation) []store.ProjectRelation {
	next := append([]store.ProjectRelation(nil), base...)
	byKey := map[string]int{}
	for index, relation := range next {
		byKey[RelationMergeKey(relation)] = index
	}
	for _, relation := range overlay {
		key := RelationMergeKey(relation)
		if index, ok := byKey[key]; ok {
			next[index] = relation
			continue
		}
		byKey[key] = len(next)
		next = append(next, relation)
	}
	return next
}

func hasRuntimeRelation(relations []store.ProjectRelation, target store.ProjectRelation) bool {
	key := RelationMergeKey(target)
	for _, relation := range relations {
		if RelationMergeKey(relation) == key {
			return true
		}
	}
	return false
}

func mergeOverlayDiagnostics(base, overlay []store.IndexDiagnostic) []store.IndexDiagnostic {
	next := append([]store.IndexDiagnostic(nil), base...)
	byID := map[string]int{}
	for index, diagnostic := range next {
		byID[diagnostic.ID] = index
	}
	for _, diagnostic := range overlay {
		if index, ok := byID[diagnostic.ID]; ok {
			next[index] = diagnostic
			continue
		}
		byID[diagnostic.ID] = len(next)
		next = append(next, diagnostic)
	}
	return next
}

func projectRuntimeOwnerHealth(definitions []store.ProjectDefinition, overlay RuntimeOverlay) []store.ProjectDefinition {
	next := append([]store.ProjectDefinition(nil), definitions...)
	for index, definition := range next {
		if definition.ID != overlay.Owner.DefinitionID {
			continue
		}
		status := "ok"
		if overlay.Error != nil {
			status = "error"
		}
		health := map[string]any{"status": status, "observedAt": overlay.ObservedAt}
		if overlay.Revision != "" {
			health["revision"] = overlay.Revision
		}
		if overlay.Error != nil {
			health["error"] = overlay.Error
		}
		metadata, err := json.Marshal(map[string]any{"runtimeOverlay": health})
		if err == nil {
			next[index].Metadata = mergeMetadataRaw(definition.Metadata, metadata)
		}
		break
	}
	return next
}
