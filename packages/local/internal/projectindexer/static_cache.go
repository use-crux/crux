package projectindexer

import "github.com/use-crux/crux/packages/local/internal/projectindexer/staticcache"

func projectNativeStaticCacheFiles(files []projectNativeStaticSourceFile) []staticcache.SourceFile {
	out := make([]staticcache.SourceFile, 0, len(files))
	for _, file := range files {
		out = append(out, staticcache.SourceFile{
			File:       file.File,
			SourceHash: file.SourceHash,
			CacheKey:   file.CacheKey,
		})
	}
	return out
}

func projectNativeStaticCachePlan(plan projectNativeStaticPlan) staticcache.Plan {
	return staticcache.Plan{
		Files:        projectNativeStaticCacheFiles(plan.Files),
		PrimaryFiles: projectNativeStaticCacheFiles(plan.PrimaryFiles),
		CacheHits:    projectNativeStaticCacheFiles(plan.CacheHits),
		CacheMisses:  projectNativeStaticCacheFiles(plan.CacheMisses),
	}
}

func projectNativeStaticCacheSourceInput(input projectNativeStaticSourceInput) staticcache.SourceInput {
	return staticcache.SourceInput{
		Files:                 projectNativeStaticCacheFiles(input.Files),
		SemanticSourceProfile: input.SemanticSourceProfile,
	}
}
