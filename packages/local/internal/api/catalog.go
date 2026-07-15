package api

// CatalogListV1 is the canonical current-Catalog list projection.
type CatalogListV1 struct {
	SchemaVersion int                       `json:"schemaVersion"`
	Definitions   []CatalogListDefinitionV1 `json:"definitions"`
}

// CatalogListDefinitionV1 is one safe row in the Catalog list.
type CatalogListDefinitionV1 struct {
	ID       string     `json:"id"`
	Kind     string     `json:"kind"`
	Fidelity string     `json:"fidelity"`
	Status   string     `json:"status,omitempty"`
	Source   *SourceLoc `json:"source,omitempty"`
}

// CatalogRelationsV1 groups resolved relations around one definition.
type CatalogRelationsV1 struct {
	Incoming []ProjectRelation `json:"incoming"`
	Outgoing []ProjectRelation `json:"outgoing"`
}

// CatalogRuntimeActivityV1 is the bounded runtime summary attached to a
// current definition. It links to Runs without embedding run records.
type CatalogRuntimeActivityV1 struct {
	DefinitionID string `json:"definitionId"`
	RunCount     int    `json:"runCount"`
	LastRunID    string `json:"lastRunId,omitempty"`
	LastRunAt    string `json:"lastRunAt,omitempty"`
	LastStatus   string `json:"lastStatus,omitempty"`
}

// CatalogDefinitionV1 is the canonical safe detail projection for one current
// Catalog definition.
type CatalogDefinitionV1 struct {
	SchemaVersion   int                       `json:"schemaVersion"`
	Definition      ProjectDefinition         `json:"definition"`
	Relations       CatalogRelationsV1        `json:"relations"`
	Evidence        []CatalogEvidenceV1       `json:"evidence"`
	Diagnostics     []IndexDiagnostic         `json:"diagnostics"`
	Lints           []IndexLintFinding        `json:"lints"`
	Quality         *IndexQuality             `json:"quality,omitempty"`
	RuntimeActivity *CatalogRuntimeActivityV1 `json:"runtimeActivity,omitempty"`
}

// CatalogEvidenceV1 explains one compiler-owned contribution to a definition.
type CatalogEvidenceV1 struct {
	Phase    string     `json:"phase"`
	Producer string     `json:"producer"`
	Fidelity string     `json:"fidelity"`
	Source   *SourceLoc `json:"source,omitempty"`
	Reason   string     `json:"reason"`
}

// CatalogUnresolvedRelationV1 is compiler-owned evidence that a relation was
// omitted or could not be resolved. The ID is the diagnostic or relation ID.
type CatalogUnresolvedRelationV1 struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// CatalogExplanationRelationsV1 groups resolved and unresolved relation
// evidence for a Catalog explanation.
type CatalogExplanationRelationsV1 struct {
	Incoming   []ProjectRelation             `json:"incoming"`
	Outgoing   []ProjectRelation             `json:"outgoing"`
	Unresolved []CatalogUnresolvedRelationV1 `json:"unresolved"`
}

// CatalogExplanationIndexingV1 records only indexing facts known to the local
// read model. Unknown backend or fallback data is omitted.
type CatalogExplanationIndexingV1 struct {
	Backend       string `json:"backend,omitempty"`
	Cache         string `json:"cache,omitempty"`
	Fallback      string `json:"fallback,omitempty"`
	PartialReason string `json:"partialReason,omitempty"`
}

// CatalogManifestResolutionV1 is an optional exact historical-manifest join.
// The v1 CLI explains the current Catalog, while devtools can reuse this field.
type CatalogManifestResolutionV1 struct {
	ProjectID  string `json:"projectId"`
	ManifestID string `json:"manifestId,omitempty"`
	Resolution string `json:"resolution"`
}

// CatalogExplanationV1 is the stable, privacy-safe explanation contract.
type CatalogExplanationV1 struct {
	SchemaVersion int                           `json:"schemaVersion"`
	Definition    ProjectDefinition             `json:"definition"`
	Evidence      []CatalogEvidenceV1           `json:"evidence"`
	Relations     CatalogExplanationRelationsV1 `json:"relations"`
	Diagnostics   []IndexDiagnostic             `json:"diagnostics"`
	Lints         []IndexLintFinding            `json:"lints"`
	Indexing      CatalogExplanationIndexingV1  `json:"indexing"`
	Manifest      *CatalogManifestResolutionV1  `json:"manifest,omitempty"`
}

// CatalogManifestIdentityV1 identifies a known current deployment manifest.
type CatalogManifestIdentityV1 struct {
	ProjectID  string `json:"projectId"`
	ManifestID string `json:"manifestId"`
}

// CatalogManifestStatusV1 reports immutable store population and, only when
// known, the current manifest identity.
type CatalogManifestStatusV1 struct {
	Count   *int                       `json:"count,omitempty"`
	Current *CatalogManifestIdentityV1 `json:"current,omitempty"`
}

// CatalogCountsV1 summarizes the current Catalog without inventing health.
type CatalogCountsV1 struct {
	Definitions int `json:"definitions"`
	Relations   int `json:"relations"`
	Diagnostics int `json:"diagnostics"`
	Lints       int `json:"lints"`
}

// CatalogSemanticStatusV1 reports semantic execution identity when known.
// Backend remains omitted when the worker did not report its selected engine.
type CatalogSemanticStatusV1 struct {
	Mode    string `json:"mode,omitempty"`
	Backend string `json:"backend,omitempty"`
}

// CatalogStatusV1 is the canonical current compiler/watch/manifest status.
type CatalogStatusV1 struct {
	SchemaVersion int                      `json:"schemaVersion"`
	Catalog       CatalogCountsV1          `json:"catalog"`
	Indexing      *ProjectIndexingStatus   `json:"indexing,omitempty"`
	Semantic      *CatalogSemanticStatusV1 `json:"semantic,omitempty"`
	Watch         *ProjectIndexWatchStatus `json:"watch,omitempty"`
	Manifests     CatalogManifestStatusV1  `json:"manifests"`
}
