package devtools

import "encoding/json"

// ProjectStaticSyntaxPlan is the Node-owned plan for native static parsing.
type ProjectStaticSyntaxPlan struct {
	Root                     string                      `json:"root"`
	ProjectName              string                      `json:"projectName,omitempty"`
	ConfigFile               string                      `json:"configFile,omitempty"`
	Files                    []string                    `json:"files"`
	FilesToParse             []string                    `json:"filesToParse"`
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
	NativeAstEnabled         bool                        `json:"nativeAstEnabled,omitempty"`
	StaticInterests          json.RawMessage             `json:"staticInterests,omitempty"`
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
}

// SyntaxFrontend identifies the parser frontend that produced syntax records.
type SyntaxFrontend struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}
