package devtools

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type IndexPatchPhase string

const (
	indexPatchPhaseCache    IndexPatchPhase = "cache"
	indexPatchPhaseAST      IndexPatchPhase = "ast"
	indexPatchPhaseSemantic IndexPatchPhase = "semantic"
	indexPatchPhaseRuntime  IndexPatchPhase = "runtime"
	indexPatchPhaseQuality  IndexPatchPhase = "quality"
)

type IndexPatch struct {
	SchemaVersion int                          `json:"schemaVersion"`
	Phase         IndexPatchPhase              `json:"phase"`
	Project       store.ProjectIdentity        `json:"project"`
	StartedAt     string                       `json:"startedAt"`
	FinishedAt    string                       `json:"finishedAt,omitempty"`
	Status        string                       `json:"status"`
	Indexing      *store.ProjectIndexingStatus `json:"indexing,omitempty"`
	Facts         IndexPatchFacts              `json:"facts"`
	// SemanticSourceProfile is transient compiler handoff metadata from AST
	// indexing to semantic indexing. It is not applied to the read model.
	SemanticSourceProfile *SemanticSourceProfile  `json:"semanticSourceProfile,omitempty"`
	Invalidates           *IndexPatchInvalidation `json:"invalidates,omitempty"`
	// FactEnvelopes carries validated V2 worker facts for durable storage.
	// It is intentionally excluded from JSON so IndexPatch keeps its existing
	// wire shape for tests, API responses, and worker phase metadata.
	FactEnvelopes []IndexFactEnvelope `json:"-"`
}

type SemanticSourceProfile struct {
	Files             []SemanticSourceProfileFile `json:"files"`
	DependencyClosure []string                    `json:"dependencyClosure"`
	SourceBytes       int                         `json:"sourceBytes"`
	Complete          bool                        `json:"complete"`
}

type SemanticSourceProfileFile struct {
	File        string                      `json:"file"`
	SourceHash  string                      `json:"sourceHash"`
	SourceBytes int                         `json:"sourceBytes"`
	Hints       *SemanticSourceProfileHints `json:"hints,omitempty"`
}

type SemanticSourceProfileHints struct {
	CruxCallNames             []string `json:"cruxCallNames,omitempty"`
	HasZodObject              bool     `json:"hasZodObject"`
	NativeDirectCruxCandidate bool     `json:"nativeDirectCruxCandidate"`
}

type IndexPatchInvalidation struct {
	Files         []string `json:"files,omitempty"`
	DefinitionIDs []string `json:"definitionIds,omitempty"`
	All           bool     `json:"all,omitempty"`
}

type IndexPatchFacts struct {
	Prompts         []store.PromptMeta             `json:"prompts,omitempty"`
	Contexts        []store.ContextMeta            `json:"contexts,omitempty"`
	Tools           []store.ToolMeta               `json:"tools,omitempty"`
	Lint            *store.IndexLintConfig         `json:"lint,omitempty"`
	Definitions     []store.ProjectDefinition      `json:"definitions,omitempty"`
	Relations       []store.ProjectRelation        `json:"relations,omitempty"`
	SourceRefs      []IndexSourceRefFact           `json:"sourceRefs,omitempty"`
	Diagnostics     []store.IndexDiagnostic        `json:"diagnostics,omitempty"`
	LintFindings    []store.IndexLintFinding       `json:"lintFindings,omitempty"`
	RuleDescriptors []store.IndexRuleDescriptor    `json:"ruleDescriptors,omitempty"`
	Sources         []store.IndexSourceFile        `json:"sources,omitempty"`
	SourceGraph     *store.ProjectIndexSourceGraph `json:"sourceGraph,omitempty"`
}

type IndexPatchBudget struct {
	MaxFiles        int `json:"maxFiles,omitempty"`
	MaxDefinitions  int `json:"maxDefinitions,omitempty"`
	MaxRelations    int `json:"maxRelations,omitempty"`
	MaxSourceRefs   int `json:"maxSourceRefs,omitempty"`
	MaxDiagnostics  int `json:"maxDiagnostics,omitempty"`
	MaxLintFindings int `json:"maxLintFindings,omitempty"`
	MaxSources      int `json:"maxSources,omitempty"`
	MaxBytes        int `json:"maxBytes,omitempty"`
}

type indexPatchBudgetViolation struct {
	Metric string
	Actual int
	Limit  int
}

type IndexSourceRefFact struct {
	DefinitionID string                 `json:"definitionId"`
	Ref          store.ProjectSourceRef `json:"ref"`
}

type indexPatchState struct {
	Index              store.IndexData
	DiagnosticsByPhase map[IndexPatchPhase][]store.IndexDiagnostic
	DefinitionPhases   map[string]IndexPatchPhase
	RelationPhases     map[string]IndexPatchPhase
	LintFindingPhases  map[string]IndexPatchPhase
	SourcePhases       map[string]IndexPatchPhase
}

func emptyIndexPatchState() indexPatchState {
	return indexPatchState{
		Index:              store.IndexData{},
		DiagnosticsByPhase: map[IndexPatchPhase][]store.IndexDiagnostic{},
		DefinitionPhases:   map[string]IndexPatchPhase{},
		RelationPhases:     map[string]IndexPatchPhase{},
		LintFindingPhases:  map[string]IndexPatchPhase{},
		SourcePhases:       map[string]IndexPatchPhase{},
	}
}

func applyIndexPatch(state indexPatchState, patch IndexPatch) indexPatchState {
	next := state
	if patch.Invalidates != nil {
		if patch.Invalidates.All {
			next = emptyIndexPatchState()
		} else {
			next = applyIndexPatchInvalidation(next, *patch.Invalidates)
		}
	}
	if patch.SchemaVersion != 0 {
		next.Index.SchemaVersion = patch.SchemaVersion
	}
	next.Index.Project = &patch.Project
	if patch.FinishedAt != "" {
		next.Index.IndexedAt = patch.FinishedAt
	}
	if patch.Indexing != nil {
		next.Index.Indexing = patch.Indexing
	}
	if patch.Facts.Prompts != nil {
		next.Index.Prompts = append([]store.PromptMeta(nil), patch.Facts.Prompts...)
	}
	if patch.Facts.Contexts != nil {
		next.Index.Contexts = append([]store.ContextMeta(nil), patch.Facts.Contexts...)
	}
	if patch.Facts.Tools != nil {
		next.Index.Tools = append([]store.ToolMeta(nil), patch.Facts.Tools...)
	}
	if patch.Facts.Lint != nil {
		next.Index.Lint = patch.Facts.Lint
	}
	next.Index.Definitions = mergePatchDefinitions(next.Index.Definitions, next.DefinitionPhases, patch.Phase, patch.Facts.Definitions)
	next.DefinitionPhases = updatePatchPhases(next.DefinitionPhases, patch.Phase, definitionIDs(patch.Facts.Definitions))
	next.Index.Definitions = applyPatchSourceRefs(next.Index.Definitions, patch.Facts.SourceRefs)
	next.Index.Relations = mergePatchFacts(next.Index.Relations, next.RelationPhases, patch.Phase, patch.Facts.Relations, relationMergeKey)
	next.RelationPhases = updatePatchPhases(next.RelationPhases, patch.Phase, relationKeys(patch.Facts.Relations))
	if patch.Phase == indexPatchPhaseQuality && patch.Facts.LintFindings != nil {
		next.Index.LintFindings, next.LintFindingPhases = removeLintFindingsByPhase(
			next.Index.LintFindings,
			next.LintFindingPhases,
			indexPatchPhaseQuality,
		)
	}
	next.Index.LintFindings = mergePatchFacts(next.Index.LintFindings, next.LintFindingPhases, patch.Phase, patch.Facts.LintFindings, func(item store.IndexLintFinding) string { return item.ID })
	next.LintFindingPhases = updatePatchPhases(next.LintFindingPhases, patch.Phase, lintFindingIDs(patch.Facts.LintFindings))
	if patch.Facts.RuleDescriptors != nil {
		next.Index.RuleDescriptors = append([]store.IndexRuleDescriptor(nil), patch.Facts.RuleDescriptors...)
	}
	next.Index.Sources = mergePatchSources(next.Index.Sources, next.SourcePhases, patch.Phase, patch.Facts.Sources)
	next.SourcePhases = updatePatchPhases(next.SourcePhases, patch.Phase, sourceIDs(patch.Facts.Sources))
	if patch.Facts.SourceGraph != nil {
		next.Index.SourceGraph = patch.Facts.SourceGraph
	}
	if patch.Facts.Diagnostics != nil {
		if patch.Phase == indexPatchPhaseQuality {
			next.DiagnosticsByPhase[patch.Phase] = nil
		}
		next.DiagnosticsByPhase[patch.Phase] = mergePatchDiagnostics(next.DiagnosticsByPhase[patch.Phase], patch.Facts.Diagnostics)
		next.Index.Diagnostics = diagnosticsFromPatchPhases(next.DiagnosticsByPhase)
	}
	next.Index.Definitions = finalizeInjectionInputContracts(next.Index.Definitions, next.Index.Relations)
	return next
}

func applyIndexPatchInvalidation(state indexPatchState, invalidates IndexPatchInvalidation) indexPatchState {
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

func indexPatchFromSnapshot(index store.IndexData, phase IndexPatchPhase, status string) IndexPatch {
	project := store.ProjectIdentity{}
	if index.Project != nil {
		project = *index.Project
	}
	return IndexPatch{
		SchemaVersion: index.SchemaVersion,
		Phase:         phase,
		Project:       project,
		StartedAt:     index.IndexedAt,
		FinishedAt:    index.IndexedAt,
		Status:        status,
		Indexing:      index.Indexing,
		Invalidates:   &IndexPatchInvalidation{All: true},
		Facts: IndexPatchFacts{
			Prompts:         index.Prompts,
			Contexts:        index.Contexts,
			Tools:           index.Tools,
			Lint:            index.Lint,
			Definitions:     index.Definitions,
			Relations:       index.Relations,
			Diagnostics:     index.Diagnostics,
			LintFindings:    index.LintFindings,
			RuleDescriptors: index.RuleDescriptors,
			Sources:         index.Sources,
			SourceGraph:     index.SourceGraph,
		},
	}
}

// MergeIndexPatches deterministically applies patch lanes in order and returns
// one patch-shaped AST handoff for the existing service interface.
//
// It reuses the same invalidation, source-row, definition, relation, and
// diagnostic merge logic used by ApplyIndexPatch, so native-static hosts can
// merge separately produced lanes without growing a second read-model merge
// implementation in the server package.
func MergeIndexPatches(patches []IndexPatch) (IndexPatch, error) {
	if len(patches) == 0 {
		return IndexPatch{}, fmt.Errorf("merge index patches: no patches")
	}
	state := emptyIndexPatchState()
	status := "ok"
	var semanticSourceProfile *SemanticSourceProfile
	envelopes := []IndexFactEnvelope{}
	for _, patch := range patches {
		state = applyIndexPatch(state, patch)
		status = mergePatchStatus(status, patch.Status)
		if patch.SemanticSourceProfile != nil {
			semanticSourceProfile = patch.SemanticSourceProfile
		}
		envelopes = append(envelopes, patch.FactEnvelopes...)
	}
	merged := indexPatchFromSnapshot(state.Index, patches[len(patches)-1].Phase, status)
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

func validateIndexPatchBudget(patch IndexPatch, budget IndexPatchBudget) error {
	violations := indexPatchBudgetViolations(patch, budget)
	if len(violations) == 0 {
		return nil
	}
	parts := make([]string, 0, len(violations))
	for _, violation := range violations {
		parts = append(parts, fmt.Sprintf("%s %d/%d", violation.Metric, violation.Actual, violation.Limit))
	}
	return fmt.Errorf("index %s patch exceeded budget: %s", patch.Phase, strings.Join(parts, ", "))
}

func indexPatchBudgetViolations(patch IndexPatch, budget IndexPatchBudget) []indexPatchBudgetViolation {
	violations := []indexPatchBudgetViolation{}
	violations = appendIndexPatchBudgetViolation(violations, "definitions", len(patch.Facts.Definitions), budget.MaxDefinitions)
	violations = appendIndexPatchBudgetViolation(violations, "relations", len(patch.Facts.Relations), budget.MaxRelations)
	violations = appendIndexPatchBudgetViolation(violations, "sourceRefs", len(patch.Facts.SourceRefs), budget.MaxSourceRefs)
	violations = appendIndexPatchBudgetViolation(violations, "diagnostics", len(patch.Facts.Diagnostics), budget.MaxDiagnostics)
	violations = appendIndexPatchBudgetViolation(violations, "lintFindings", len(patch.Facts.LintFindings), budget.MaxLintFindings)
	violations = appendIndexPatchBudgetViolation(violations, "sources", len(patch.Facts.Sources), budget.MaxSources)
	if budget.MaxBytes > 0 {
		if data, err := json.Marshal(patch); err == nil {
			violations = appendIndexPatchBudgetViolation(violations, "bytes", len(data), budget.MaxBytes)
		}
	}
	return violations
}

func appendIndexPatchBudgetViolation(violations []indexPatchBudgetViolation, metric string, actual int, limit int) []indexPatchBudgetViolation {
	if limit > 0 && actual > limit {
		return append(violations, indexPatchBudgetViolation{Metric: metric, Actual: actual, Limit: limit})
	}
	return violations
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
			if phase != indexPatchPhaseSemantic {
				index[item.ID] = len(merged)
				merged = append(merged, item)
			}
			continue
		}
		currentPhase := phases[item.ID]
		if currentPhase == "" {
			currentPhase = indexPatchPhaseCache
		}
		if indexPatchPhaseRank(phase) < indexPatchPhaseRank(currentPhase) {
			continue
		}
		merged[existingIndex] = mergePatchDefinition(merged[existingIndex], currentPhase, item, phase)
	}
	return merged
}

func mergePatchDefinition(existing store.ProjectDefinition, existingPhase IndexPatchPhase, incoming store.ProjectDefinition, incomingPhase IndexPatchPhase) store.ProjectDefinition {
	if existingPhase == indexPatchPhaseCache && incomingPhase != indexPatchPhaseCache {
		return incoming
	}
	if incomingPhase == indexPatchPhaseSemantic {
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
			currentPhase = indexPatchPhaseCache
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
			currentPhase = indexPatchPhaseCache
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
	for _, phase := range []IndexPatchPhase{indexPatchPhaseCache, indexPatchPhaseAST, indexPatchPhaseSemantic, indexPatchPhaseRuntime, indexPatchPhaseQuality} {
		diagnostics = append(diagnostics, byPhase[phase]...)
	}
	return diagnostics
}

func indexPatchPhaseRank(phase IndexPatchPhase) int {
	switch phase {
	case indexPatchPhaseQuality:
		return 4
	case indexPatchPhaseRuntime:
		return 3
	case indexPatchPhaseSemantic:
		return 2
	case indexPatchPhaseAST:
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
