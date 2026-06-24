package server

import "github.com/use-crux/crux/packages/local/internal/devtools"

type projectNativeStaticSourceInputCacheEntry struct {
	CacheKey        string
	SourceHash      string
	SemanticProfile *devtools.SemanticSourceProfileFile
}

func projectNativeStaticSourceInputCacheEntries(
	entries []devtools.StaticCacheHit,
) map[string]projectNativeStaticSourceInputCacheEntry {
	out := map[string]projectNativeStaticSourceInputCacheEntry{}
	for _, entry := range entries {
		if entry.File == "" || entry.CacheKey == "" {
			continue
		}
		out[entry.File] = projectNativeStaticSourceInputCacheEntry{
			CacheKey:        entry.CacheKey,
			SourceHash:      entry.SourceHash,
			SemanticProfile: entry.SemanticProfile,
		}
	}
	return out
}

func projectNativeStaticSourceInputFiles(plan devtools.ProjectStaticSyntaxPlan) []string {
	if plan.FilesToParse == nil {
		return projectNativeStaticUniqueFiles(plan.Files)
	}
	selected := projectNativeStaticPrimaryFileSet(plan)
	for _, file := range plan.FilesToParse {
		if file != "" {
			selected[file] = true
		}
	}
	return projectNativeStaticUniqueSelectedFiles(plan.Files, selected)
}

func projectNativeStaticUniqueSelectedFiles(files []string, selected map[string]bool) []string {
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

func projectNativeStaticSourceInputFilesToRead(
	files []string,
	analyzeFileSet map[string]bool,
	cacheEntries map[string]projectNativeStaticSourceInputCacheEntry,
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

func projectNativeStaticSourceReadMap(
	reads []projectNativeStaticSourceRead,
) map[string]projectNativeStaticSourceRead {
	out := make(map[string]projectNativeStaticSourceRead, len(reads))
	for _, read := range reads {
		if read.file != "" {
			out[read.file] = read
		}
	}
	return out
}

func projectNativeStaticSourceInputCachedProfile(
	file string,
	entry projectNativeStaticSourceInputCacheEntry,
) (devtools.SemanticSourceProfileFile, bool) {
	if file == "" || entry.SemanticProfile == nil {
		return devtools.SemanticSourceProfileFile{}, false
	}
	profile := *entry.SemanticProfile
	profile.File = file
	profile.SourceHash = entry.SourceHash
	if profile.SourceHash == "" {
		return devtools.SemanticSourceProfileFile{}, false
	}
	return profile, true
}
