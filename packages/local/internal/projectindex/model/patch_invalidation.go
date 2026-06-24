package model

import "github.com/use-crux/crux/packages/local/internal/store"

func applyIndexPatchInvalidation(state PatchState, invalidates IndexPatchInvalidation) PatchState {
	invalidatedFiles := stringSetFromSlice(invalidates.Files)
	invalidatedDefinitionIDs := stringSetFromSlice(invalidates.DefinitionIDs)
	invalidatedDiagnosticIDs := map[string]bool{}

	for _, source := range state.Index.Sources {
		if invalidatedFiles[source.File] {
			for _, definitionID := range source.DefinitionIDs {
				invalidatedDefinitionIDs[definitionID] = true
			}
			for _, diagnosticID := range source.Diagnostics {
				invalidatedDiagnosticIDs[diagnosticID] = true
			}
		}
	}
	for _, definition := range state.Index.Definitions {
		if sourceFileMatches(definition.Source, invalidatedFiles) {
			invalidatedDefinitionIDs[definition.ID] = true
		}
	}

	invalidatedRelationIDs := map[string]bool{}
	for _, relation := range state.Index.Relations {
		if sourceFileMatches(relation.Source, invalidatedFiles) ||
			invalidatedDefinitionIDs[relation.From] ||
			invalidatedDefinitionIDs[relation.To] {
			invalidatedRelationIDs[relation.ID] = true
			invalidatedRelationIDs[relationMergeKey(relation)] = true
		}
	}

	for _, diagnostic := range state.Index.Diagnostics {
		if sourceFileMatches(diagnostic.Source, invalidatedFiles) ||
			anyStringInSet(diagnostic.RelatedDefinitionIDs, invalidatedDefinitionIDs) {
			invalidatedDiagnosticIDs[diagnostic.ID] = true
		}
	}

	next := state
	next.Index.Definitions = filterDefinitions(state.Index.Definitions, invalidatedFiles, invalidatedDefinitionIDs)
	next.Index.Relations = filterRelations(state.Index.Relations, invalidatedFiles, invalidatedDefinitionIDs)
	next.Index.LintFindings = filterLintFindings(state.Index.LintFindings, invalidatedFiles, invalidatedDefinitionIDs, invalidatedRelationIDs)
	next.Index.Sources = filterSources(state.Index.Sources, invalidatedFiles, invalidatedDefinitionIDs, invalidatedDiagnosticIDs)
	next.DiagnosticsByPhase = filterDiagnosticsByPhase(state.DiagnosticsByPhase, invalidatedFiles, invalidatedDefinitionIDs, invalidatedDiagnosticIDs)
	next.Index.Diagnostics = diagnosticsFromPatchPhases(next.DiagnosticsByPhase)
	next.DefinitionPhases = filterPhaseMap(state.DefinitionPhases, invalidatedDefinitionIDs)
	next.RelationPhases = filterPhaseMap(state.RelationPhases, invalidatedRelationIDs)
	next.LintFindingPhases = filterPhaseMapByIndexLintFindings(next.LintFindingPhases, next.Index.LintFindings)
	next.SourcePhases = filterPhaseMap(state.SourcePhases, invalidatedFiles)
	return next
}
func filterDefinitions(definitions []store.ProjectDefinition, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool) []store.ProjectDefinition {
	next := make([]store.ProjectDefinition, 0, len(definitions))
	for _, definition := range definitions {
		if invalidatedDefinitionIDs[definition.ID] || sourceFileMatches(definition.Source, invalidatedFiles) {
			continue
		}
		next = append(next, definition)
	}
	return next
}

func filterRelations(relations []store.ProjectRelation, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool) []store.ProjectRelation {
	next := make([]store.ProjectRelation, 0, len(relations))
	for _, relation := range relations {
		if sourceFileMatches(relation.Source, invalidatedFiles) ||
			invalidatedDefinitionIDs[relation.From] ||
			invalidatedDefinitionIDs[relation.To] {
			continue
		}
		next = append(next, relation)
	}
	return next
}

func filterLintFindings(findings []store.IndexLintFinding, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool, invalidatedRelationIDs map[string]bool) []store.IndexLintFinding {
	next := make([]store.IndexLintFinding, 0, len(findings))
	for _, finding := range findings {
		if sourceFileMatches(finding.Source, invalidatedFiles) ||
			invalidatedDefinitionIDs[finding.PrimaryDefinitionID] ||
			anyStringInSet(finding.RelatedDefinitionIDs, invalidatedDefinitionIDs) ||
			anyStringInSet(finding.AffectedDefinitionIDs, invalidatedDefinitionIDs) ||
			anyStringInSet(finding.PropagatedDefinitionIDs, invalidatedDefinitionIDs) ||
			lintEvidenceInvalidated(finding.Evidence, invalidatedFiles, invalidatedDefinitionIDs, invalidatedRelationIDs) {
			continue
		}
		next = append(next, finding)
	}
	return next
}

func lintEvidenceInvalidated(evidence []store.IndexLintEvidence, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool, invalidatedRelationIDs map[string]bool) bool {
	for _, item := range evidence {
		if invalidatedDefinitionIDs[item.DefinitionID] || invalidatedRelationIDs[item.RelationID] || sourceFileMatches(item.Source, invalidatedFiles) {
			return true
		}
	}
	return false
}

func filterSources(sources []store.IndexSourceFile, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool, invalidatedDiagnosticIDs map[string]bool) []store.IndexSourceFile {
	next := make([]store.IndexSourceFile, 0, len(sources))
	for _, source := range sources {
		if invalidatedFiles[source.File] {
			continue
		}
		source.DefinitionIDs = filterStringsNotInSet(source.DefinitionIDs, invalidatedDefinitionIDs)
		source.Diagnostics = filterStringsNotInSet(source.Diagnostics, invalidatedDiagnosticIDs)
		next = append(next, source)
	}
	return next
}

func filterDiagnosticsByPhase(byPhase map[IndexPatchPhase][]store.IndexDiagnostic, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool, invalidatedDiagnosticIDs map[string]bool) map[IndexPatchPhase][]store.IndexDiagnostic {
	next := map[IndexPatchPhase][]store.IndexDiagnostic{}
	for phase, diagnostics := range byPhase {
		filtered := make([]store.IndexDiagnostic, 0, len(diagnostics))
		for _, diagnostic := range diagnostics {
			if invalidatedDiagnosticIDs[diagnostic.ID] ||
				sourceFileMatches(diagnostic.Source, invalidatedFiles) ||
				anyStringInSet(diagnostic.RelatedDefinitionIDs, invalidatedDefinitionIDs) {
				continue
			}
			filtered = append(filtered, diagnostic)
		}
		if len(filtered) > 0 {
			next[phase] = filtered
		}
	}
	return next
}

func filterPhaseMap(phases map[string]IndexPatchPhase, invalidated map[string]bool) map[string]IndexPatchPhase {
	next := map[string]IndexPatchPhase{}
	for id, phase := range phases {
		if invalidated[id] {
			continue
		}
		next[id] = phase
	}
	return next
}

func filterPhaseMapByIndexLintFindings(phases map[string]IndexPatchPhase, findings []store.IndexLintFinding) map[string]IndexPatchPhase {
	remaining := map[string]bool{}
	for _, finding := range findings {
		remaining[finding.ID] = true
	}
	next := map[string]IndexPatchPhase{}
	for id, phase := range phases {
		if remaining[id] {
			next[id] = phase
		}
	}
	return next
}
func sourceFileMatches(source *store.SourceLoc, files map[string]bool) bool {
	return source != nil && files[source.File]
}

func anyStringInSet(values []string, set map[string]bool) bool {
	for _, value := range values {
		if set[value] {
			return true
		}
	}
	return false
}

func filterStringsNotInSet(values []string, set map[string]bool) []string {
	if len(values) == 0 {
		return nil
	}
	next := make([]string, 0, len(values))
	for _, value := range values {
		if !set[value] {
			next = append(next, value)
		}
	}
	return next
}

func stringSetFromSlice(values []string) map[string]bool {
	set := map[string]bool{}
	for _, value := range values {
		if value != "" {
			set[value] = true
		}
	}
	return set
}
