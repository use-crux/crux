package projectwatch

import (
	"path/filepath"
	"strings"
)

var ignoredDirectoryNames = map[string]bool{
	".crux":        true,
	".git":         true,
	".next":        true,
	".turbo":       true,
	".vercel":      true,
	"build":        true,
	"coverage":     true,
	"dist":         true,
	"node_modules": true,
	"out":          true,
}

var watchedFileExtensions = map[string]bool{
	".cjs":  true,
	".cts":  true,
	".js":   true,
	".json": true,
	".jsx":  true,
	".mjs":  true,
	".mts":  true,
	".ts":   true,
	".tsx":  true,
}

var watchedBaseNames = map[string]bool{
	".gitmodules":       true,
	"crux.config.mts":   true,
	"crux.config.ts":    true,
	"jsconfig.json":     true,
	"package-lock.json": true,
	"package.json":      true,
	"pnpm-lock.yaml":    true,
	"tsconfig.json":     true,
	"yarn.lock":         true,
}

func shouldIgnoreDir(path string) bool {
	return ignoredDirectoryNames[filepath.Base(path)]
}

func shouldWatchFile(path string) bool {
	base := filepath.Base(path)
	if strings.HasPrefix(base, ".") && !watchedBaseNames[base] {
		return false
	}
	if watchedBaseNames[base] {
		return true
	}
	return watchedFileExtensions[strings.ToLower(filepath.Ext(base))]
}

func pathInsideIgnoredDir(root string, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil || strings.HasPrefix(rel, "..") {
		return true
	}
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		if ignoredDirectoryNames[part] {
			return true
		}
	}
	return false
}
