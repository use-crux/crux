package projectindexer

import "github.com/use-crux/crux/packages/local/internal/projectindexer/staticcache"

func projectNativeStaticCacheSourceInput(input projectNativeStaticSourceInput) staticcache.SourceInput {
	return staticcache.SourceInput{
		Files:                 input.Files,
		SemanticSourceProfile: input.SemanticSourceProfile,
	}
}
