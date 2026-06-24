package staticcache

import "github.com/use-crux/crux/packages/local/internal/devtools"

type SourceFile struct {
	File       string `json:"file"`
	SourceHash string `json:"sourceHash"`
	CacheKey   string `json:"cacheKey,omitempty"`
}

type Plan struct {
	Files        []SourceFile
	PrimaryFiles []SourceFile
	CacheHits    []SourceFile
	CacheMisses  []SourceFile
}

type SourceInput struct {
	Files                 []SourceFile
	SemanticSourceProfile *devtools.SemanticSourceProfile
}
