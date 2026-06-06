package devtools

// ProjectIndexIncrementalResult is the worker/service contract for applying an
// incremental Project Catalog refresh. Patches are ordered and must be applied
// sequentially to the previous catalog state.
type ProjectIndexIncrementalResult struct {
	Decision map[string]any                `json:"decision"`
	Patches  []CatalogPatch                `json:"patches"`
	Report   ProjectIndexIncrementalReport `json:"report"`
}

// ProjectIndexIncrementalReport carries JSON-safe planning and execution
// telemetry for logs, diagnostics, and future devtools UI surfaces.
type ProjectIndexIncrementalReport struct {
	PlanKind                 string             `json:"planKind"`
	FallbackUsed             bool               `json:"fallbackUsed"`
	FallbackReason           string             `json:"fallbackReason,omitempty"`
	GraphConfidence          string             `json:"graphConfidence"`
	ChangedFiles             []string           `json:"changedFiles"`
	DeletedFiles             []string           `json:"deletedFiles"`
	AffectedFiles            []string           `json:"affectedFiles"`
	AffectedDefinitionIDs    []string           `json:"affectedDefinitionIds"`
	StaticParsedFiles        []string           `json:"staticParsedFiles"`
	StaticCacheHits          int                `json:"staticCacheHits"`
	StaticCacheMisses        int                `json:"staticCacheMisses"`
	SemanticAnalyzedFiles    []string           `json:"semanticAnalyzedFiles"`
	SemanticCacheHits        int                `json:"semanticCacheHits"`
	SemanticCacheMisses      int                `json:"semanticCacheMisses"`
	InvalidatedFiles         []string           `json:"invalidatedFiles"`
	InvalidatedDefinitionIDs []string           `json:"invalidatedDefinitionIds"`
	DurationMsByPhase        map[string]float64 `json:"durationMsByPhase"`
}
