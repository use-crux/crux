package devtools

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type CatalogPatchPhase string

const (
	catalogPatchPhaseCache    CatalogPatchPhase = "cache"
	catalogPatchPhaseAST      CatalogPatchPhase = "ast"
	catalogPatchPhaseSemantic CatalogPatchPhase = "semantic"
	catalogPatchPhaseRuntime  CatalogPatchPhase = "runtime"
	catalogPatchPhaseQuality  CatalogPatchPhase = "quality"
)

type CatalogPatch struct {
	SchemaVersion int                                 `json:"schemaVersion"`
	Phase         CatalogPatchPhase                   `json:"phase"`
	Project       store.ProjectIdentity               `json:"project"`
	StartedAt     string                              `json:"startedAt"`
	FinishedAt    string                              `json:"finishedAt,omitempty"`
	Status        string                              `json:"status"`
	Indexing      *store.ProjectCatalogIndexingStatus `json:"indexing,omitempty"`
	Facts         CatalogPatchFacts                   `json:"facts"`
	Invalidates   *CatalogPatchInvalidation           `json:"invalidates,omitempty"`
}

type CatalogPatchInvalidation struct {
	Files         []string `json:"files,omitempty"`
	DefinitionIDs []string `json:"definitionIds,omitempty"`
	All           bool     `json:"all,omitempty"`
}

type CatalogPatchFacts struct {
	Prompts      []store.PromptMeta               `json:"prompts,omitempty"`
	Contexts     []store.ContextMeta              `json:"contexts,omitempty"`
	Tools        []store.ToolMeta                 `json:"tools,omitempty"`
	Lint         *store.CatalogLintConfig         `json:"lint,omitempty"`
	Definitions  []store.ProjectDefinition        `json:"definitions,omitempty"`
	Relations    []store.ProjectRelation          `json:"relations,omitempty"`
	SourceRefs   []CatalogSourceRefFact           `json:"sourceRefs,omitempty"`
	Diagnostics  []store.CatalogDiagnostic        `json:"diagnostics,omitempty"`
	LintFindings []store.CatalogLintFinding       `json:"lintFindings,omitempty"`
	Sources      []store.CatalogSourceFile        `json:"sources,omitempty"`
	SourceGraph  *store.ProjectCatalogSourceGraph `json:"sourceGraph,omitempty"`
}

type CatalogPatchBudget struct {
	MaxFiles        int `json:"maxFiles,omitempty"`
	MaxDefinitions  int `json:"maxDefinitions,omitempty"`
	MaxRelations    int `json:"maxRelations,omitempty"`
	MaxSourceRefs   int `json:"maxSourceRefs,omitempty"`
	MaxDiagnostics  int `json:"maxDiagnostics,omitempty"`
	MaxLintFindings int `json:"maxLintFindings,omitempty"`
	MaxSources      int `json:"maxSources,omitempty"`
	MaxBytes        int `json:"maxBytes,omitempty"`
}

type catalogPatchBudgetViolation struct {
	Metric string
	Actual int
	Limit  int
}

type CatalogSourceRefFact struct {
	DefinitionID string                 `json:"definitionId"`
	Ref          store.ProjectSourceRef `json:"ref"`
}

type catalogPatchState struct {
	Catalog            store.CatalogData
	DiagnosticsByPhase map[CatalogPatchPhase][]store.CatalogDiagnostic
	DefinitionPhases   map[string]CatalogPatchPhase
	RelationPhases     map[string]CatalogPatchPhase
	LintFindingPhases  map[string]CatalogPatchPhase
	SourcePhases       map[string]CatalogPatchPhase
}

func emptyCatalogPatchState() catalogPatchState {
	return catalogPatchState{
		Catalog:            store.CatalogData{},
		DiagnosticsByPhase: map[CatalogPatchPhase][]store.CatalogDiagnostic{},
		DefinitionPhases:   map[string]CatalogPatchPhase{},
		RelationPhases:     map[string]CatalogPatchPhase{},
		LintFindingPhases:  map[string]CatalogPatchPhase{},
		SourcePhases:       map[string]CatalogPatchPhase{},
	}
}

func applyCatalogPatch(state catalogPatchState, patch CatalogPatch) catalogPatchState {
	next := state
	if patch.Invalidates != nil {
		if patch.Invalidates.All {
			next = emptyCatalogPatchState()
		} else {
			next = applyCatalogPatchInvalidation(next, *patch.Invalidates)
		}
	}
	if patch.SchemaVersion != 0 {
		next.Catalog.SchemaVersion = patch.SchemaVersion
	}
	next.Catalog.Project = &patch.Project
	if patch.FinishedAt != "" {
		next.Catalog.IndexedAt = patch.FinishedAt
	}
	if patch.Indexing != nil {
		next.Catalog.Indexing = patch.Indexing
	}
	if patch.Facts.Prompts != nil {
		next.Catalog.Prompts = append([]store.PromptMeta(nil), patch.Facts.Prompts...)
	}
	if patch.Facts.Contexts != nil {
		next.Catalog.Contexts = append([]store.ContextMeta(nil), patch.Facts.Contexts...)
	}
	if patch.Facts.Tools != nil {
		next.Catalog.Tools = append([]store.ToolMeta(nil), patch.Facts.Tools...)
	}
	if patch.Facts.Lint != nil {
		next.Catalog.Lint = patch.Facts.Lint
	}
	next.Catalog.Definitions = mergePatchDefinitions(next.Catalog.Definitions, next.DefinitionPhases, patch.Phase, patch.Facts.Definitions)
	next.DefinitionPhases = updatePatchPhases(next.DefinitionPhases, patch.Phase, definitionIDs(patch.Facts.Definitions))
	next.Catalog.Definitions = applyPatchSourceRefs(next.Catalog.Definitions, patch.Facts.SourceRefs)
	next.Catalog.Relations = mergePatchFacts(next.Catalog.Relations, next.RelationPhases, patch.Phase, patch.Facts.Relations, relationMergeKey)
	next.RelationPhases = updatePatchPhases(next.RelationPhases, patch.Phase, relationKeys(patch.Facts.Relations))
	next.Catalog.LintFindings = mergePatchFacts(next.Catalog.LintFindings, next.LintFindingPhases, patch.Phase, patch.Facts.LintFindings, func(item store.CatalogLintFinding) string { return item.ID })
	next.LintFindingPhases = updatePatchPhases(next.LintFindingPhases, patch.Phase, lintFindingIDs(patch.Facts.LintFindings))
	next.Catalog.Sources = mergePatchSources(next.Catalog.Sources, next.SourcePhases, patch.Phase, patch.Facts.Sources)
	next.SourcePhases = updatePatchPhases(next.SourcePhases, patch.Phase, sourceIDs(patch.Facts.Sources))
	if patch.Facts.SourceGraph != nil {
		next.Catalog.SourceGraph = patch.Facts.SourceGraph
	}
	if patch.Facts.Diagnostics != nil {
		next.DiagnosticsByPhase[patch.Phase] = mergePatchDiagnostics(next.DiagnosticsByPhase[patch.Phase], patch.Facts.Diagnostics)
		next.Catalog.Diagnostics = diagnosticsFromPatchPhases(next.DiagnosticsByPhase)
	}
	return next
}

func applyCatalogPatchInvalidation(state catalogPatchState, invalidates CatalogPatchInvalidation) catalogPatchState {
	invalidatedFiles := stringSetFromSlice(invalidates.Files)
	invalidatedDefinitionIDs := stringSetFromSlice(invalidates.DefinitionIDs)
	invalidatedDiagnosticIDs := map[string]bool{}

	for _, source := range state.Catalog.Sources {
		if invalidatedFiles[source.File] {
			for _, definitionID := range source.DefinitionIDs {
				invalidatedDefinitionIDs[definitionID] = true
			}
			for _, diagnosticID := range source.Diagnostics {
				invalidatedDiagnosticIDs[diagnosticID] = true
			}
		}
	}
	for _, definition := range state.Catalog.Definitions {
		if sourceFileMatches(definition.Source, invalidatedFiles) {
			invalidatedDefinitionIDs[definition.ID] = true
		}
	}

	invalidatedRelationIDs := map[string]bool{}
	for _, relation := range state.Catalog.Relations {
		if sourceFileMatches(relation.Source, invalidatedFiles) ||
			invalidatedDefinitionIDs[relation.From] ||
			invalidatedDefinitionIDs[relation.To] {
			invalidatedRelationIDs[relation.ID] = true
			invalidatedRelationIDs[relationMergeKey(relation)] = true
		}
	}

	for _, diagnostic := range state.Catalog.Diagnostics {
		if sourceFileMatches(diagnostic.Source, invalidatedFiles) ||
			anyStringInSet(diagnostic.RelatedDefinitionIDs, invalidatedDefinitionIDs) {
			invalidatedDiagnosticIDs[diagnostic.ID] = true
		}
	}

	next := state
	next.Catalog.Definitions = filterDefinitions(state.Catalog.Definitions, invalidatedFiles, invalidatedDefinitionIDs)
	next.Catalog.Relations = filterRelations(state.Catalog.Relations, invalidatedFiles, invalidatedDefinitionIDs)
	next.Catalog.LintFindings = filterLintFindings(state.Catalog.LintFindings, invalidatedFiles, invalidatedDefinitionIDs, invalidatedRelationIDs)
	next.Catalog.Sources = filterSources(state.Catalog.Sources, invalidatedFiles, invalidatedDefinitionIDs, invalidatedDiagnosticIDs)
	next.DiagnosticsByPhase = filterDiagnosticsByPhase(state.DiagnosticsByPhase, invalidatedFiles, invalidatedDefinitionIDs, invalidatedDiagnosticIDs)
	next.Catalog.Diagnostics = diagnosticsFromPatchPhases(next.DiagnosticsByPhase)
	next.DefinitionPhases = filterPhaseMap(state.DefinitionPhases, invalidatedDefinitionIDs)
	next.RelationPhases = filterPhaseMap(state.RelationPhases, invalidatedRelationIDs)
	next.LintFindingPhases = filterPhaseMapByCatalogLintFindings(next.LintFindingPhases, next.Catalog.LintFindings)
	next.SourcePhases = filterPhaseMap(state.SourcePhases, invalidatedFiles)
	return next
}

func catalogPatchFromSnapshot(catalog store.CatalogData, phase CatalogPatchPhase, status string) CatalogPatch {
	project := store.ProjectIdentity{}
	if catalog.Project != nil {
		project = *catalog.Project
	}
	return CatalogPatch{
		SchemaVersion: catalog.SchemaVersion,
		Phase:         phase,
		Project:       project,
		StartedAt:     catalog.IndexedAt,
		FinishedAt:    catalog.IndexedAt,
		Status:        status,
		Indexing:      catalog.Indexing,
		Invalidates:   &CatalogPatchInvalidation{All: true},
		Facts: CatalogPatchFacts{
			Prompts:      catalog.Prompts,
			Contexts:     catalog.Contexts,
			Tools:        catalog.Tools,
			Lint:         catalog.Lint,
			Definitions:  catalog.Definitions,
			Relations:    catalog.Relations,
			Diagnostics:  catalog.Diagnostics,
			LintFindings: catalog.LintFindings,
			Sources:      catalog.Sources,
			SourceGraph:  catalog.SourceGraph,
		},
	}
}

func validateCatalogPatchBudget(patch CatalogPatch, budget CatalogPatchBudget) error {
	violations := catalogPatchBudgetViolations(patch, budget)
	if len(violations) == 0 {
		return nil
	}
	parts := make([]string, 0, len(violations))
	for _, violation := range violations {
		parts = append(parts, fmt.Sprintf("%s %d/%d", violation.Metric, violation.Actual, violation.Limit))
	}
	return fmt.Errorf("catalog %s patch exceeded budget: %s", patch.Phase, strings.Join(parts, ", "))
}

func catalogPatchBudgetViolations(patch CatalogPatch, budget CatalogPatchBudget) []catalogPatchBudgetViolation {
	violations := []catalogPatchBudgetViolation{}
	violations = appendCatalogPatchBudgetViolation(violations, "definitions", len(patch.Facts.Definitions), budget.MaxDefinitions)
	violations = appendCatalogPatchBudgetViolation(violations, "relations", len(patch.Facts.Relations), budget.MaxRelations)
	violations = appendCatalogPatchBudgetViolation(violations, "sourceRefs", len(patch.Facts.SourceRefs), budget.MaxSourceRefs)
	violations = appendCatalogPatchBudgetViolation(violations, "diagnostics", len(patch.Facts.Diagnostics), budget.MaxDiagnostics)
	violations = appendCatalogPatchBudgetViolation(violations, "lintFindings", len(patch.Facts.LintFindings), budget.MaxLintFindings)
	violations = appendCatalogPatchBudgetViolation(violations, "sources", len(patch.Facts.Sources), budget.MaxSources)
	if budget.MaxBytes > 0 {
		if data, err := json.Marshal(patch); err == nil {
			violations = appendCatalogPatchBudgetViolation(violations, "bytes", len(data), budget.MaxBytes)
		}
	}
	return violations
}

func appendCatalogPatchBudgetViolation(violations []catalogPatchBudgetViolation, metric string, actual int, limit int) []catalogPatchBudgetViolation {
	if limit > 0 && actual > limit {
		return append(violations, catalogPatchBudgetViolation{Metric: metric, Actual: actual, Limit: limit})
	}
	return violations
}

func mergePatchDefinitions(existing []store.ProjectDefinition, phases map[string]CatalogPatchPhase, phase CatalogPatchPhase, incoming []store.ProjectDefinition) []store.ProjectDefinition {
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
			if phase != catalogPatchPhaseSemantic {
				index[item.ID] = len(merged)
				merged = append(merged, item)
			}
			continue
		}
		currentPhase := phases[item.ID]
		if currentPhase == "" {
			currentPhase = catalogPatchPhaseCache
		}
		if catalogPatchPhaseRank(phase) < catalogPatchPhaseRank(currentPhase) {
			continue
		}
		merged[existingIndex] = mergePatchDefinition(merged[existingIndex], currentPhase, item, phase)
	}
	return merged
}

func mergePatchDefinition(existing store.ProjectDefinition, existingPhase CatalogPatchPhase, incoming store.ProjectDefinition, incomingPhase CatalogPatchPhase) store.ProjectDefinition {
	if existingPhase == catalogPatchPhaseCache && incomingPhase != catalogPatchPhaseCache {
		return incoming
	}
	if incomingPhase == catalogPatchPhaseSemantic {
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

func applyPatchSourceRefs(definitions []store.ProjectDefinition, refs []CatalogSourceRefFact) []store.ProjectDefinition {
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

func mergePatchFacts[T any](existing []T, phases map[string]CatalogPatchPhase, phase CatalogPatchPhase, incoming []T, idFor func(T) string) []T {
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
			currentPhase = catalogPatchPhaseCache
		}
		if existingIndex, ok := index[id]; ok {
			if catalogPatchPhaseRank(phase) >= catalogPatchPhaseRank(currentPhase) {
				merged[existingIndex] = item
			}
			continue
		}
		index[id] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergePatchSources(existing []store.CatalogSourceFile, phases map[string]CatalogPatchPhase, phase CatalogPatchPhase, incoming []store.CatalogSourceFile) []store.CatalogSourceFile {
	merged := make([]store.CatalogSourceFile, 0, len(existing)+len(incoming))
	index := map[string]int{}
	for _, item := range existing {
		if existingIndex, ok := index[item.File]; ok {
			merged[existingIndex] = mergeCatalogSourceFile(merged[existingIndex], item)
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
			currentPhase = catalogPatchPhaseCache
		}
		if existingIndex, ok := index[item.File]; ok {
			if catalogPatchPhaseRank(phase) >= catalogPatchPhaseRank(currentPhase) {
				merged[existingIndex] = mergeCatalogSourceFile(merged[existingIndex], item)
			}
			continue
		}
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func mergeCatalogSourceFile(existing store.CatalogSourceFile, incoming store.CatalogSourceFile) store.CatalogSourceFile {
	if incoming.Status != "" {
		existing.Status = incoming.Status
	}
	existing.DefinitionIDs = appendUniqueStrings(existing.DefinitionIDs, incoming.DefinitionIDs)
	existing.Dependencies = appendUniqueStrings(existing.Dependencies, incoming.Dependencies)
	existing.Dependents = appendUniqueStrings(existing.Dependents, incoming.Dependents)
	existing.Diagnostics = appendUniqueStrings(existing.Diagnostics, incoming.Diagnostics)
	return existing
}

func mergePatchDiagnostics(existing []store.CatalogDiagnostic, incoming []store.CatalogDiagnostic) []store.CatalogDiagnostic {
	merged := make([]store.CatalogDiagnostic, 0, len(existing)+len(incoming))
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

func filterLintFindings(findings []store.CatalogLintFinding, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool, invalidatedRelationIDs map[string]bool) []store.CatalogLintFinding {
	next := make([]store.CatalogLintFinding, 0, len(findings))
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

func lintEvidenceInvalidated(evidence []store.CatalogLintEvidence, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool, invalidatedRelationIDs map[string]bool) bool {
	for _, item := range evidence {
		if invalidatedDefinitionIDs[item.DefinitionID] || invalidatedRelationIDs[item.RelationID] || sourceFileMatches(item.Source, invalidatedFiles) {
			return true
		}
	}
	return false
}

func filterSources(sources []store.CatalogSourceFile, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool, invalidatedDiagnosticIDs map[string]bool) []store.CatalogSourceFile {
	next := make([]store.CatalogSourceFile, 0, len(sources))
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

func filterDiagnosticsByPhase(byPhase map[CatalogPatchPhase][]store.CatalogDiagnostic, invalidatedFiles map[string]bool, invalidatedDefinitionIDs map[string]bool, invalidatedDiagnosticIDs map[string]bool) map[CatalogPatchPhase][]store.CatalogDiagnostic {
	next := map[CatalogPatchPhase][]store.CatalogDiagnostic{}
	for phase, diagnostics := range byPhase {
		filtered := make([]store.CatalogDiagnostic, 0, len(diagnostics))
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

func filterPhaseMap(phases map[string]CatalogPatchPhase, invalidated map[string]bool) map[string]CatalogPatchPhase {
	next := map[string]CatalogPatchPhase{}
	for id, phase := range phases {
		if invalidated[id] {
			continue
		}
		next[id] = phase
	}
	return next
}

func filterPhaseMapByCatalogLintFindings(phases map[string]CatalogPatchPhase, findings []store.CatalogLintFinding) map[string]CatalogPatchPhase {
	remaining := map[string]bool{}
	for _, finding := range findings {
		remaining[finding.ID] = true
	}
	next := map[string]CatalogPatchPhase{}
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

func updatePatchPhases(existing map[string]CatalogPatchPhase, phase CatalogPatchPhase, ids []string) map[string]CatalogPatchPhase {
	next := map[string]CatalogPatchPhase{}
	for id, current := range existing {
		next[id] = current
	}
	for _, id := range ids {
		current := next[id]
		if current == "" || catalogPatchPhaseRank(phase) >= catalogPatchPhaseRank(current) {
			next[id] = phase
		}
	}
	return next
}

func diagnosticsFromPatchPhases(byPhase map[CatalogPatchPhase][]store.CatalogDiagnostic) []store.CatalogDiagnostic {
	var diagnostics []store.CatalogDiagnostic
	for _, phase := range []CatalogPatchPhase{catalogPatchPhaseCache, catalogPatchPhaseAST, catalogPatchPhaseSemantic, catalogPatchPhaseRuntime, catalogPatchPhaseQuality} {
		diagnostics = append(diagnostics, byPhase[phase]...)
	}
	return diagnostics
}

func catalogPatchPhaseRank(phase CatalogPatchPhase) int {
	switch phase {
	case catalogPatchPhaseQuality:
		return 4
	case catalogPatchPhaseRuntime:
		return 3
	case catalogPatchPhaseSemantic:
		return 2
	case catalogPatchPhaseAST:
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

func relationMergeKey(relation store.ProjectRelation) string {
	if relation.Type == "" || relation.From == "" || relation.To == "" {
		return relation.ID
	}
	return fmt.Sprintf("relation:%s:%s:%s", relation.Type, relation.From, relation.To)
}

func lintFindingIDs(findings []store.CatalogLintFinding) []string {
	ids := make([]string, 0, len(findings))
	for _, finding := range findings {
		ids = append(ids, finding.ID)
	}
	return ids
}

func sourceIDs(sources []store.CatalogSourceFile) []string {
	ids := make([]string, 0, len(sources))
	for _, source := range sources {
		ids = append(ids, source.File)
	}
	return ids
}
