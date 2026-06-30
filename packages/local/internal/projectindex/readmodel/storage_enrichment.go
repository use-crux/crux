package readmodel

import (
	"encoding/json"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type storageComponentSummary struct {
	RecordStoreID string `json:"recordStoreId,omitempty"`
	VectorStoreID string `json:"vectorStoreId,omitempty"`
	BlobStoreID   string `json:"blobStoreId,omitempty"`
	StorageID     string `json:"storageId,omitempty"`
}

type storageUsageSummary struct {
	DefinitionID string `json:"definitionId"`
	Kind         string `json:"kind,omitempty"`
	Name         string `json:"name,omitempty"`
	RelationType string `json:"relationType"`
}

type storageWarningSummary struct {
	Code                 string   `json:"code"`
	Severity             string   `json:"severity"`
	Message              string   `json:"message"`
	PrimaryDefinitionID  string   `json:"primaryDefinitionId,omitempty"`
	RelatedDefinitionIDs []string `json:"relatedDefinitionIds,omitempty"`
}

type storageDefinitionSummary struct {
	Kind         string                  `json:"kind"`
	Backend      string                  `json:"backend,omitempty"`
	VariableName string                  `json:"variableName,omitempty"`
	Prefix       string                  `json:"prefix,omitempty"`
	Components   storageComponentSummary `json:"components,omitempty"`
	Capabilities map[string]any          `json:"capabilities,omitempty"`
	UsedBy       []storageUsageSummary   `json:"usedBy,omitempty"`
	Warnings     []storageWarningSummary `json:"warnings,omitempty"`
}

func enrichStorage(index store.IndexData) store.IndexData {
	if len(index.Definitions) == 0 {
		return index
	}
	defs := make([]store.ProjectDefinition, len(index.Definitions))
	copy(defs, index.Definitions)
	byID := make(map[string]store.ProjectDefinition, len(defs))
	for _, def := range defs {
		byID[def.ID] = def
	}
	relations := storageRelations(index.Relations)
	if len(relations.outgoing) == 0 && len(relations.incoming) == 0 {
		return index
	}

	var warnings []storageWarningSummary
	for i := range defs {
		if !isStorageKind(defs[i].Kind) {
			continue
		}
		summary := storageSummaryForDefinition(defs[i], byID, relations)
		summary.Warnings = storageWarnings(defs[i], summary, relations, byID)
		warnings = append(warnings, summary.Warnings...)
		metadata := rawMap(defs[i].Metadata)
		metadata["storage"] = summary
		defs[i].Metadata = mustMarshalJSON(metadata)
	}
	index.Definitions = defs
	index.LintFindings = mergeStorageLintFindings(index.LintFindings, warnings)
	return index
}

type storageRelationIndex struct {
	outgoing map[string][]store.ProjectRelation
	incoming map[string][]store.ProjectRelation
}

func storageRelations(relations []store.ProjectRelation) storageRelationIndex {
	index := storageRelationIndex{outgoing: map[string][]store.ProjectRelation{}, incoming: map[string][]store.ProjectRelation{}}
	for _, relation := range relations {
		if !isStorageRelation(relation.Type) {
			continue
		}
		index.outgoing[relation.From] = append(index.outgoing[relation.From], relation)
		index.incoming[relation.To] = append(index.incoming[relation.To], relation)
	}
	return index
}

func storageSummaryForDefinition(def store.ProjectDefinition, byID map[string]store.ProjectDefinition, relations storageRelationIndex) storageDefinitionSummary {
	facts := storageFacts(def)
	summary := storageDefinitionSummary{
		Kind:         def.Kind,
		Backend:      stringFact(facts, "backend"),
		VariableName: stringFact(facts, "variableName"),
		Prefix:       stringFact(facts, "prefix"),
		Components:   storageComponents(def.ID, relations),
		Capabilities: resolvedStorageCapabilities(def.ID, byID, relations, map[string]bool{}),
		UsedBy:       storageUsedBy(def.ID, relations, byID),
	}
	return summary
}

func storageFacts(def store.ProjectDefinition) map[string]any {
	metadata := rawMap(def.Metadata)
	facts := rawMapAny(metadata["facts"])
	if len(facts) == 0 {
		facts = map[string]any{"kind": def.Kind}
	}
	return facts
}

func storageComponents(defID string, relations storageRelationIndex) storageComponentSummary {
	var components storageComponentSummary
	for _, relation := range relations.outgoing[defID] {
		switch relation.Type {
		case "storage.bundle.uses_record_store":
			components.RecordStoreID = relation.To
		case "storage.bundle.uses_vector_store":
			components.VectorStoreID = relation.To
		case "storage.bundle.uses_blob_store":
			components.BlobStoreID = relation.To
		case "storage.scope.wraps_storage":
			components.StorageID = relation.To
		}
	}
	return components
}

func resolvedStorageCapabilities(defID string, byID map[string]store.ProjectDefinition, relations storageRelationIndex, seen map[string]bool) map[string]any {
	if seen[defID] {
		return nil
	}
	seen[defID] = true
	def, ok := byID[defID]
	if !ok {
		return nil
	}
	capabilities := cloneMap(rawMapAny(storageFacts(def)["capabilities"]))
	for _, relation := range relations.outgoing[defID] {
		switch relation.Type {
		case "storage.bundle.uses_record_store", "storage.bundle.uses_vector_store", "storage.bundle.uses_blob_store", "storage.scope.wraps_storage":
			mergeCapabilityMaps(capabilities, resolvedStorageCapabilities(relation.To, byID, relations, seen))
		}
	}
	if len(capabilities) == 0 {
		return nil
	}
	return capabilities
}

func mergeCapabilityMaps(dst map[string]any, src map[string]any) {
	for key, value := range src {
		if _, exists := dst[key]; !exists {
			dst[key] = value
		}
	}
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	var out map[string]any
	raw, err := json.Marshal(input)
	if err != nil {
		return map[string]any{}
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func storageUsedBy(defID string, relations storageRelationIndex, byID map[string]store.ProjectDefinition) []storageUsageSummary {
	var usedBy []storageUsageSummary
	for _, relation := range relations.incoming[defID] {
		if isStorageKind(byID[relation.From].Kind) {
			continue
		}
		def := byID[relation.From]
		usedBy = append(usedBy, storageUsageSummary{
			DefinitionID: relation.From,
			Kind:         def.Kind,
			Name:         def.Name,
			RelationType: relation.Type,
		})
	}
	sort.Slice(usedBy, func(i, j int) bool {
		if usedBy[i].Kind == usedBy[j].Kind {
			return usedBy[i].DefinitionID < usedBy[j].DefinitionID
		}
		return usedBy[i].Kind < usedBy[j].Kind
	})
	return usedBy
}

func isStorageKind(kind string) bool {
	switch kind {
	case "storage.recordStore", "storage.vectorStore", "storage.blobStore", "storage.bundle", "storage.scope":
		return true
	default:
		return false
	}
}

func isStorageRelation(relationType string) bool {
	switch relationType {
	case "storage.bundle.uses_record_store", "storage.bundle.uses_vector_store", "storage.bundle.uses_blob_store", "storage.scope.wraps_storage",
		"rag.retriever.uses_storage", "rag.retriever.uses_record_store", "rag.retriever.uses_vector_store", "rag.retriever.uses_blob_store",
		"workspace.uses_storage", "workspace.uses_record_store", "workspace.uses_vector_store", "workspace.uses_blob_store":
		return true
	default:
		return false
	}
}

func stringFact(facts map[string]any, key string) string {
	value, _ := facts[key].(string)
	return value
}
