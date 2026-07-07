package model

// ProjectIndexIncrementalResult is the worker/service contract for applying an
// incremental Project Index refresh. Patches are ordered and must be applied
// sequentially to the previous index state.
type ProjectIndexIncrementalResult struct {
	Decision map[string]any                `json:"decision"`
	Patches  []IndexPatch                  `json:"patches"`
	Report   ProjectIndexIncrementalReport `json:"report"`
}

// ProjectIndexIncrementalReport carries JSON-safe planning and execution
// telemetry for logs, diagnostics, and future devtools UI surfaces.
type ProjectIndexIncrementalReport struct {
	PlanKind                 string                  `json:"planKind"`
	FallbackUsed             bool                    `json:"fallbackUsed"`
	FallbackReason           string                  `json:"fallbackReason,omitempty"`
	ASTUsedStaticIndex       bool                    `json:"astUsedStaticIndex"`
	GraphConfidence          string                  `json:"graphConfidence"`
	ChangedFiles             []string                `json:"changedFiles"`
	DeletedFiles             []string                `json:"deletedFiles"`
	AffectedFiles            []string                `json:"affectedFiles"`
	AffectedDefinitionIDs    []string                `json:"affectedDefinitionIds"`
	StaticParsedFiles        []string                `json:"staticParsedFiles"`
	StaticCacheHits          int                     `json:"staticCacheHits"`
	StaticCacheMisses        int                     `json:"staticCacheMisses"`
	SemanticAnalyzedFiles    []string                `json:"semanticAnalyzedFiles"`
	SemanticCacheHits        int                     `json:"semanticCacheHits"`
	SemanticCacheMisses      int                     `json:"semanticCacheMisses"`
	InvalidatedFiles         []string                `json:"invalidatedFiles"`
	InvalidatedDefinitionIDs []string                `json:"invalidatedDefinitionIds"`
	DurationMsByPhase        map[string]float64      `json:"durationMsByPhase"`
	PatchCounts              ProjectIndexPatchCounts `json:"patchCounts"`
	SourceProfileFileCount   int                     `json:"sourceProfileFileCount"`
	SemanticStatus           string                  `json:"semanticStatus"`
}

type ProjectIndexPatchCounts struct {
	AST      int `json:"ast"`
	Semantic int `json:"semantic"`
	Total    int `json:"total"`
}
