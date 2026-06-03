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
	Prompts      []store.PromptMeta         `json:"prompts,omitempty"`
	Contexts     []store.ContextMeta        `json:"contexts,omitempty"`
	Tools        []store.ToolMeta           `json:"tools,omitempty"`
	Lint         *store.CatalogLintConfig   `json:"lint,omitempty"`
	Definitions  []store.ProjectDefinition  `json:"definitions,omitempty"`
	Relations    []store.ProjectRelation    `json:"relations,omitempty"`
	SourceRefs   []CatalogSourceRefFact     `json:"sourceRefs,omitempty"`
	Diagnostics  []store.CatalogDiagnostic  `json:"diagnostics,omitempty"`
	LintFindings []store.CatalogLintFinding `json:"lintFindings,omitempty"`
	Sources      []store.CatalogSourceFile  `json:"sources,omitempty"`
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
	if patch.Invalidates != nil && patch.Invalidates.All {
		next = emptyCatalogPatchState()
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
	next.Catalog.Relations = mergePatchFacts(next.Catalog.Relations, next.RelationPhases, patch.Phase, patch.Facts.Relations, func(item store.ProjectRelation) string { return item.ID })
	next.RelationPhases = updatePatchPhases(next.RelationPhases, patch.Phase, relationIDs(patch.Facts.Relations))
	next.Catalog.LintFindings = mergePatchFacts(next.Catalog.LintFindings, next.LintFindingPhases, patch.Phase, patch.Facts.LintFindings, func(item store.CatalogLintFinding) string { return item.ID })
	next.LintFindingPhases = updatePatchPhases(next.LintFindingPhases, patch.Phase, lintFindingIDs(patch.Facts.LintFindings))
	next.Catalog.Sources = mergePatchFacts(next.Catalog.Sources, next.SourcePhases, patch.Phase, patch.Facts.Sources, func(item store.CatalogSourceFile) string { return item.File })
	next.SourcePhases = updatePatchPhases(next.SourcePhases, patch.Phase, sourceIDs(patch.Facts.Sources))
	if patch.Facts.Diagnostics != nil {
		next.DiagnosticsByPhase[patch.Phase] = patch.Facts.Diagnostics
		next.Catalog.Diagnostics = diagnosticsFromPatchPhases(next.DiagnosticsByPhase)
	}
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
	if len(incoming) == 0 {
		return append([]store.ProjectDefinition(nil), existing...)
	}
	merged := append([]store.ProjectDefinition(nil), existing...)
	index := map[string]int{}
	for i, item := range merged {
		index[item.ID] = i
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
	if len(incoming) == 0 {
		return append([]T(nil), existing...)
	}
	merged := append([]T(nil), existing...)
	index := map[string]int{}
	for i, item := range merged {
		index[idFor(item)] = i
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

func relationIDs(relations []store.ProjectRelation) []string {
	ids := make([]string, 0, len(relations))
	for _, relation := range relations {
		ids = append(ids, relation.ID)
	}
	return ids
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
