package model

import "github.com/use-crux/crux/packages/local/internal/store"

type IndexPatchPhase string

const (
	PhaseCache    IndexPatchPhase = "cache"
	PhaseAST      IndexPatchPhase = "ast"
	PhaseSemantic IndexPatchPhase = "semantic"
	PhaseRuntime  IndexPatchPhase = "runtime"
	PhaseQuality  IndexPatchPhase = "quality"
)

type IndexPatch struct {
	SchemaVersion   int                          `json:"schemaVersion"`
	Phase           IndexPatchPhase              `json:"phase"`
	Project         store.ProjectIdentity        `json:"project"`
	StartedAt       string                       `json:"startedAt"`
	FinishedAt      string                       `json:"finishedAt,omitempty"`
	Status          string                       `json:"status"`
	SemanticBackend string                       `json:"semanticBackend,omitempty"`
	Indexing        *store.ProjectIndexingStatus `json:"indexing,omitempty"`
	Facts           IndexPatchFacts              `json:"facts"`
	// SemanticSourceProfile is transient compiler handoff metadata from AST
	// indexing to semantic indexing. It is not applied to the read model.
	SemanticSourceProfile *SemanticSourceProfile  `json:"semanticSourceProfile,omitempty"`
	Invalidates           *IndexPatchInvalidation `json:"invalidates,omitempty"`
	// FactEnvelopes carries validated V3 worker facts for durable storage.
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

type IndexSourceRefFact struct {
	DefinitionID string                 `json:"definitionId"`
	Ref          store.ProjectSourceRef `json:"ref"`
}

type PatchState struct {
	Index              store.IndexData
	DiagnosticsByPhase map[IndexPatchPhase][]store.IndexDiagnostic
	DefinitionPhases   map[string]IndexPatchPhase
	RelationPhases     map[string]IndexPatchPhase
	LintFindingPhases  map[string]IndexPatchPhase
	SourcePhases       map[string]IndexPatchPhase
}

func EmptyPatchState() PatchState {
	return PatchState{
		Index:              store.IndexData{},
		DiagnosticsByPhase: map[IndexPatchPhase][]store.IndexDiagnostic{},
		DefinitionPhases:   map[string]IndexPatchPhase{},
		RelationPhases:     map[string]IndexPatchPhase{},
		LintFindingPhases:  map[string]IndexPatchPhase{},
		SourcePhases:       map[string]IndexPatchPhase{},
	}
}

func ApplyPatch(state PatchState, patch IndexPatch) PatchState {
	next := state
	if patch.Invalidates != nil {
		if patch.Invalidates.All {
			next = EmptyPatchState()
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
	if patch.Phase == PhaseQuality && patch.Facts.LintFindings != nil {
		next.Index.LintFindings, next.LintFindingPhases = removeLintFindingsByPhase(
			next.Index.LintFindings,
			next.LintFindingPhases,
			PhaseQuality,
		)
	}
	next.Index.LintFindings = mergePatchFacts(next.Index.LintFindings, next.LintFindingPhases, patch.Phase, patch.Facts.LintFindings, func(item store.IndexLintFinding) string { return item.ID })
	next.LintFindingPhases = updatePatchPhases(next.LintFindingPhases, patch.Phase, lintFindingIDs(patch.Facts.LintFindings))
	if patch.Facts.RuleDescriptors != nil {
		next.Index.RuleDescriptors = append([]store.IndexRuleDescriptor(nil), patch.Facts.RuleDescriptors...)
	}
	next.Index.Sources = mergePatchSources(next.Index.Sources, next.SourcePhases, patch.Phase, patch.Facts.Sources, patch.Invalidates)
	next.SourcePhases = updatePatchPhases(next.SourcePhases, patch.Phase, sourceIDs(patch.Facts.Sources))
	if patch.Facts.SourceGraph != nil {
		next.Index.SourceGraph = patch.Facts.SourceGraph
	}
	if patch.Phase == PhaseRuntime {
		next.DiagnosticsByPhase[patch.Phase] = nil
	}
	if patch.Facts.Diagnostics != nil || patch.Phase == PhaseRuntime {
		if patch.Phase == PhaseQuality {
			next.DiagnosticsByPhase[patch.Phase] = nil
		}
		next.DiagnosticsByPhase[patch.Phase] = mergePatchDiagnostics(next.DiagnosticsByPhase[patch.Phase], patch.Facts.Diagnostics)
		next.Index.Diagnostics = diagnosticsFromPatchPhases(next.DiagnosticsByPhase)
	}
	next.Index.Definitions = finalizeInjectionInputContracts(next.Index.Definitions, next.Index.Relations)
	return next
}

func PatchFromSnapshot(index store.IndexData, phase IndexPatchPhase, status string) IndexPatch {
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
