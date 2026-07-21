package model

import "encoding/json"

// ProjectStaticSyntaxPlan is the Go-owned plan for Static Syntax parsing and
// Static Index execution.
type ProjectStaticSyntaxPlan struct {
	Root              string `json:"root"`
	ProjectName       string `json:"projectName,omitempty"`
	ConfigFile        string `json:"configFile,omitempty"`
	RuntimeConfigured *bool  `json:"runtimeConfigured,omitempty"`
	// Files contains primary extraction files plus support files needed for cross-file record lookups.
	Files []string `json:"files"`
	// PrimaryFiles contains extraction targets only. It is Go-internal because
	// the Rust protocol receives typed source identities instead of this plan.
	PrimaryFiles []string `json:"-"`
	// FilesToParse contains primary cache misses plus support records the native host must still provide.
	FilesToParse []string `json:"filesToParse"`
	// CacheHits and CacheMisses describe primary extraction files only.
	CacheHits                []string                    `json:"cacheHits,omitempty"`
	CacheMisses              []string                    `json:"cacheMisses,omitempty"`
	CacheEntries             []StaticCacheHit            `json:"cacheEntries,omitempty"`
	Skipped                  []json.RawMessage           `json:"skipped,omitempty"`
	CallNames                []string                    `json:"callNames,omitempty"`
	CallInterests            []StaticCallInterest        `json:"callInterests,omitempty"`
	ConstructorNames         []string                    `json:"constructorNames,omitempty"`
	ConstructorInterests     []StaticConstructorInterest `json:"constructorInterests,omitempty"`
	PruneNativeFactCallNames []string                    `json:"pruneNativeFactCallNames,omitempty"`
	SyntaxFrontend           SyntaxFrontend              `json:"syntaxFrontend"`
	StaticInterests          json.RawMessage             `json:"staticInterests,omitempty"`
	RelationSpecs            json.RawMessage             `json:"relationSpecs,omitempty"`
	RuleDescriptors          json.RawMessage             `json:"ruleDescriptors,omitempty"`
	LintConfig               json.RawMessage             `json:"lintConfig,omitempty"`
	CacheInputs              []json.RawMessage           `json:"cacheInputs,omitempty"`
	SourceGraph              json.RawMessage             `json:"sourceGraph,omitempty"`
	StaticHost               json.RawMessage             `json:"staticHost,omitempty"`
}

// StaticCallInterest is an import-aware native syntax parser call filter.
type StaticCallInterest struct {
	Name       string                   `json:"name"`
	ImportFrom []string                 `json:"importFrom,omitempty"`
	ConfigArg  *int                     `json:"configArg,omitempty"`
	Properties []string                 `json:"properties,omitempty"`
	Callbacks  []StaticCallbackInterest `json:"callbacks,omitempty"`
	Source     string                   `json:"source,omitempty"`
}

// StaticConstructorInterest is an import-aware native syntax parser constructor filter.
type StaticConstructorInterest struct {
	Name       string                   `json:"name"`
	ImportFrom []string                 `json:"importFrom,omitempty"`
	ConfigArg  *int                     `json:"configArg,omitempty"`
	Properties []string                 `json:"properties,omitempty"`
	Callbacks  []StaticCallbackInterest `json:"callbacks,omitempty"`
	Source     string                   `json:"source,omitempty"`
}

// StaticCallbackInterest is a declared config callback property retained for TS extensions.
type StaticCallbackInterest struct {
	Property string `json:"property"`
	MaxDepth *int   `json:"maxDepth,omitempty"`
}

// StaticCacheHit is a Node-validated static parse cache entry.
type StaticCacheHit struct {
	File     string `json:"file"`
	CacheKey string `json:"cacheKey"`
	// SourceHash is the validated source hash stored in the static cache manifest.
	SourceHash string `json:"sourceHash,omitempty"`
	// SemanticProfile is transient AST-to-semantic handoff metadata replayed from cache.
	SemanticProfile *SemanticSourceProfileFile `json:"semanticProfile,omitempty"`
}

// SyntaxFrontend identifies the parser frontend that produced syntax records.
type SyntaxFrontend struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}
