package staticsource

import "github.com/use-crux/crux/packages/local/internal/projectindex"

type cacheEntry struct {
	CacheKey        string
	SourceHash      string
	SemanticProfile *projectindex.SemanticSourceProfileFile
}

func cacheEntries(
	entries []projectindex.StaticCacheHit,
) map[string]cacheEntry {
	out := map[string]cacheEntry{}
	for _, entry := range entries {
		if entry.File == "" || entry.CacheKey == "" {
			continue
		}
		out[entry.File] = cacheEntry{
			CacheKey:        entry.CacheKey,
			SourceHash:      entry.SourceHash,
			SemanticProfile: entry.SemanticProfile,
		}
	}
	return out
}

func inputFiles(plan projectindex.ProjectStaticSyntaxPlan) []string {
	if plan.FilesToParse == nil {
		return UniqueFiles(plan.Files)
	}
	selected := primaryFileSet(plan)
	for _, file := range plan.FilesToParse {
		if file != "" {
			selected[file] = true
		}
	}
	return uniqueSelectedFiles(plan.Files, selected)
}

func uniqueSelectedFiles(files []string, selected map[string]bool) []string {
	out := make([]string, 0, len(files))
	seen := map[string]bool{}
	for _, file := range files {
		if file == "" || !selected[file] || seen[file] {
			continue
		}
		seen[file] = true
		out = append(out, file)
	}
	return out
}

func filesToRead(
	files []string,
	analyzeFileSet map[string]bool,
	cacheEntries map[string]cacheEntry,
) []string {
	out := []string{}
	for _, file := range files {
		entry, hasCache := cacheEntries[file]
		if analyzeFileSet[file] || !hasCache || entry.SourceHash == "" || entry.SemanticProfile == nil {
			out = append(out, file)
		}
	}
	return out
}

func readMap(
	reads []sourceRead,
) map[string]sourceRead {
	out := make(map[string]sourceRead, len(reads))
	for _, read := range reads {
		if read.file != "" {
			out[read.file] = read
		}
	}
	return out
}

func cachedProfile(
	file string,
	entry cacheEntry,
) (projectindex.SemanticSourceProfileFile, bool) {
	if file == "" || entry.SemanticProfile == nil {
		return projectindex.SemanticSourceProfileFile{}, false
	}
	profile := *entry.SemanticProfile
	profile.File = file
	profile.SourceHash = entry.SourceHash
	if profile.SourceHash == "" {
		return projectindex.SemanticSourceProfileFile{}, false
	}
	return profile, true
}
