package model

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// MergeIndexPatches deterministically applies patch lanes in order and returns
// one patch-shaped AST handoff for the existing service interface.
//
// It reuses the same invalidation, source-row, definition, relation, and
// diagnostic merge logic used by ApplyIndexPatch, so static-index hosts can
// merge separately produced lanes without growing a second read-model merge
// implementation in the server package.
func MergeIndexPatches(patches []IndexPatch) (IndexPatch, error) {
	if len(patches) == 0 {
		return IndexPatch{}, fmt.Errorf("merge index patches: no patches")
	}
	state := EmptyPatchState()
	status := "ok"
	var semanticSourceProfile *SemanticSourceProfile
	envelopes := []IndexFactEnvelope{}
	for _, patch := range patches {
		state = ApplyPatch(state, patch)
		status = mergePatchStatus(status, patch.Status)
		if patch.SemanticSourceProfile != nil {
			semanticSourceProfile = patch.SemanticSourceProfile
		}
		envelopes = append(envelopes, patch.FactEnvelopes...)
	}
	merged := PatchFromSnapshot(state.Index, patches[len(patches)-1].Phase, status)
	merged.StartedAt = patches[0].StartedAt
	merged.FinishedAt = patches[len(patches)-1].FinishedAt
	merged.SemanticSourceProfile = semanticSourceProfile
	merged.FactEnvelopes = envelopes
	return merged, nil
}

func mergePatchStatus(current string, incoming string) string {
	if incoming == "degraded" || current == "degraded" {
		return "degraded"
	}
	if incoming == "partial" || current == "partial" {
		return "partial"
	}
	if current == "" {
		return incoming
	}
	return current
}
func mergePatchDefinitions(existing []store.ProjectDefinition, phases map[string]IndexPatchPhase, phase IndexPatchPhase, incoming []store.ProjectDefinition) []store.ProjectDefinition {
	merged := make([]store.ProjectDefinition, 0, len(existing)+len(incoming))
	index := map[string]int{}
	for _, item := range existing {
		if existingIndex, ok := index[item.ID]; ok {
			merged[existingIndex] = mergeProjectDefinition(merged[existingIndex], item)
			continue
		}
		index[item.ID] = len(merged)
		merged = append(merged, item)
	}
	if len(incoming) == 0 {
		return merged
	}
	for _, item := range incoming {
		existingIndex, ok := index[item.ID]
		if !ok {
			if phase != PhaseSemantic {
				index[item.ID] = len(merged)
				merged = append(merged, item)
			}
			continue
		}
		currentPhase := phases[item.ID]
		if currentPhase == "" {
			currentPhase = PhaseCache
		}
		if indexPatchPhaseRank(phase) < indexPatchPhaseRank(currentPhase) {
			continue
		}
		merged[existingIndex] = mergePatchDefinition(merged[existingIndex], currentPhase, item, phase)
	}
	return merged
}

func mergePatchDefinition(existing store.ProjectDefinition, existingPhase IndexPatchPhase, incoming store.ProjectDefinition, incomingPhase IndexPatchPhase) store.ProjectDefinition {
	if existingPhase == PhaseCache && incomingPhase != PhaseCache {
		return incoming
	}
	if incomingPhase == PhaseSemantic {
		if incoming.Description != "" {
			existing.Description = incoming.Description
		}
		existing.Metadata = mergeMetadataRaw(existing.Metadata, incoming.Metadata)
		if incoming.Quality != nil {
			existing.Quality = incoming.Quality
		}
		existing.SourceRefs = mergeProjectSourceRefs(existing.SourceRefs, incoming.SourceRefs)
		return existing
	}
	return mergeProjectDefinition(existing, incoming)
}

func applyPatchSourceRefs(definitions []store.ProjectDefinition, refs []IndexSourceRefFact) []store.ProjectDefinition {
	if len(refs) == 0 {
		return append([]store.ProjectDefinition(nil), definitions...)
	}
	byDefinition := map[string][]store.ProjectSourceRef{}
	for _, ref := range refs {
		byDefinition[ref.DefinitionID] = append(byDefinition[ref.DefinitionID], ref.Ref)
	}
	next := append([]store.ProjectDefinition(nil), definitions...)
	for i := range next {
		if refsForDefinition := byDefinition[next[i].ID]; len(refsForDefinition) > 0 {
			next[i].SourceRefs = mergeProjectSourceRefs(next[i].SourceRefs, refsForDefinition)
		}
	}
	return next
}

func mergeProjectSourceRefs(existing []store.ProjectSourceRef, incoming []store.ProjectSourceRef) []store.ProjectSourceRef {
	if len(existing) == 0 {
		return append([]store.ProjectSourceRef(nil), incoming...)
	}
	if len(incoming) == 0 {
		return append([]store.ProjectSourceRef(nil), existing...)
	}
	merged := append([]store.ProjectSourceRef(nil), existing...)
	index := map[string]int{}
	for i, ref := range merged {
		index[ref.ID] = i
	}
	for _, ref := range incoming {
		if existingIndex, ok := index[ref.ID]; ok {
			merged[existingIndex] = ref
			continue
		}
		index[ref.ID] = len(merged)
		merged = append(merged, ref)
	}
	return merged
}

func mergePatchFacts[T any](existing []T, phases map[string]IndexPatchPhase, phase IndexPatchPhase, incoming []T, idFor func(T) string) []T {
	merged := make([]T, 0, len(existing)+len(incoming))
	index := map[string]int{}
	for _, item := range existing {
		id := idFor(item)
		if existingIndex, ok := index[id]; ok {
			merged[existingIndex] = item
			continue
		}
		index[id] = len(merged)
		merged = append(merged, item)
	}
	if len(incoming) == 0 {
		return merged
	}
	for _, item := range incoming {
		id := idFor(item)
		currentPhase := phases[id]
		if currentPhase == "" {
			currentPhase = PhaseCache
		}
		if existingIndex, ok := index[id]; ok {
			if indexPatchPhaseRank(phase) >= indexPatchPhaseRank(currentPhase) {
				merged[existingIndex] = item
			}
			continue
		}
		index[id] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergePatchSources(existing []store.IndexSourceFile, phases map[string]IndexPatchPhase, phase IndexPatchPhase, incoming []store.IndexSourceFile) []store.IndexSourceFile {
	merged := make([]store.IndexSourceFile, 0, len(existing)+len(incoming))
	index := map[string]int{}
	for _, item := range existing {
		if existingIndex, ok := index[item.File]; ok {
			merged[existingIndex] = mergeIndexSourceFile(merged[existingIndex], item)
			continue
		}
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	if len(incoming) == 0 {
		return merged
	}
	for _, item := range incoming {
		currentPhase := phases[item.File]
		if currentPhase == "" {
			currentPhase = PhaseCache
		}
		if existingIndex, ok := index[item.File]; ok {
			if indexPatchPhaseRank(phase) >= indexPatchPhaseRank(currentPhase) {
				merged[existingIndex] = mergeIndexSourceFile(merged[existingIndex], item)
			}
			continue
		}
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeIndexSourceFile(existing store.IndexSourceFile, incoming store.IndexSourceFile) store.IndexSourceFile {
	if incoming.Status != "" {
		existing.Status = incoming.Status
	}
	if incoming.ShardID != "" {
		existing.ShardID = incoming.ShardID
	}
	existing.DefinitionIDs = appendUniqueStrings(existing.DefinitionIDs, incoming.DefinitionIDs)
	existing.Dependencies = appendUniqueStrings(existing.Dependencies, incoming.Dependencies)
	existing.Dependents = appendUniqueStrings(existing.Dependents, incoming.Dependents)
	existing.Diagnostics = appendUniqueStrings(existing.Diagnostics, incoming.Diagnostics)
	return existing
}

func mergePatchDiagnostics(existing []store.IndexDiagnostic, incoming []store.IndexDiagnostic) []store.IndexDiagnostic {
	merged := make([]store.IndexDiagnostic, 0, len(existing)+len(incoming))
	index := map[string]int{}
	for _, diagnostic := range existing {
		if existingIndex, ok := index[diagnostic.ID]; ok {
			merged[existingIndex] = diagnostic
			continue
		}
		index[diagnostic.ID] = len(merged)
		merged = append(merged, diagnostic)
	}
	for _, diagnostic := range incoming {
		if existingIndex, ok := index[diagnostic.ID]; ok {
			merged[existingIndex] = diagnostic
			continue
		}
		index[diagnostic.ID] = len(merged)
		merged = append(merged, diagnostic)
	}
	return merged
}
func removeLintFindingsByPhase(findings []store.IndexLintFinding, phases map[string]IndexPatchPhase, phase IndexPatchPhase) ([]store.IndexLintFinding, map[string]IndexPatchPhase) {
	nextFindings := make([]store.IndexLintFinding, 0, len(findings))
	nextPhases := map[string]IndexPatchPhase{}
	for _, finding := range findings {
		if phases[finding.ID] == phase {
			continue
		}
		nextFindings = append(nextFindings, finding)
		if current := phases[finding.ID]; current != "" {
			nextPhases[finding.ID] = current
		}
	}
	return nextFindings, nextPhases
}

func appendUniqueStrings(existing []string, incoming []string) []string {
	next := append([]string(nil), existing...)
	seen := stringSetFromSlice(next)
	for _, value := range incoming {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		next = append(next, value)
	}
	return next
}

func updatePatchPhases(existing map[string]IndexPatchPhase, phase IndexPatchPhase, ids []string) map[string]IndexPatchPhase {
	next := map[string]IndexPatchPhase{}
	for id, current := range existing {
		next[id] = current
	}
	for _, id := range ids {
		current := next[id]
		if current == "" || indexPatchPhaseRank(phase) >= indexPatchPhaseRank(current) {
			next[id] = phase
		}
	}
	return next
}

func diagnosticsFromPatchPhases(byPhase map[IndexPatchPhase][]store.IndexDiagnostic) []store.IndexDiagnostic {
	var diagnostics []store.IndexDiagnostic
	for _, phase := range []IndexPatchPhase{PhaseCache, PhaseAST, PhaseSemantic, PhaseRuntime, PhaseQuality} {
		diagnostics = append(diagnostics, byPhase[phase]...)
	}
	return diagnostics
}

func indexPatchPhaseRank(phase IndexPatchPhase) int {
	switch phase {
	case PhaseQuality:
		return 4
	case PhaseRuntime:
		return 3
	case PhaseSemantic:
		return 2
	case PhaseAST:
		return 1
	default:
		return 0
	}
}

func definitionIDs(definitions []store.ProjectDefinition) []string {
	ids := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		ids = append(ids, definition.ID)
	}
	return ids
}

func relationKeys(relations []store.ProjectRelation) []string {
	ids := make([]string, 0, len(relations))
	for _, relation := range relations {
		ids = append(ids, relationMergeKey(relation))
	}
	return ids
}

func RelationMergeKey(relation store.ProjectRelation) string {
	return relationMergeKey(relation)
}

func relationMergeKey(relation store.ProjectRelation) string {
	if relation.Type == "" || relation.From == "" || relation.To == "" {
		return relation.ID
	}
	return fmt.Sprintf("relation:%s:%s:%s", relation.Type, relation.From, relation.To)
}

func lintFindingIDs(findings []store.IndexLintFinding) []string {
	ids := make([]string, 0, len(findings))
	for _, finding := range findings {
		ids = append(ids, finding.ID)
	}
	return ids
}

func sourceIDs(sources []store.IndexSourceFile) []string {
	ids := make([]string, 0, len(sources))
	for _, source := range sources {
		ids = append(ids, source.File)
	}
	return ids
}
