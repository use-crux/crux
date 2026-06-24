package server

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

const projectNativeStaticParseCacheEpoch = "static-parse-v38"

type projectNativeStaticCacheStatus struct {
	CacheHits    []string
	CacheMisses  []string
	CacheEntries []devtools.StaticCacheHit
}

type projectNativeStaticParseCacheManifestEntry struct {
	Version        string                                    `json:"version"`
	Root           string                                    `json:"root"`
	File           string                                    `json:"file"`
	SourceHash     string                                    `json:"sourceHash"`
	Dependencies   []projectNativeStaticParseCacheSourceHash `json:"dependencies"`
	ConfigFiles    []projectNativeStaticParseCacheSourceHash `json:"configFiles"`
	CompilerInputs []json.RawMessage                         `json:"compilerInputs"`
	CacheKey       string                                    `json:"cacheKey"`
}

type projectNativeStaticParseCacheSourceHash struct {
	File       string `json:"file"`
	SourceHash string `json:"sourceHash"`
}

func projectNativeStaticCacheManifestStatus(
	root string,
	files []string,
	compilerInputs []json.RawMessage,
) projectNativeStaticCacheStatus {
	wantedIdentities := projectNativeStaticCacheManifestIdentities(root, files, compilerInputs)
	entries := projectNativeStaticReadCacheManifestEntries(root, wantedIdentities)
	configFiles := projectNativeStaticReadConfigFileHashes(root)
	sourceHashes := newProjectNativeStaticSourceHashMemo()
	statuses := projectNativeStaticCacheManifestFileStatuses(root, files, compilerInputs, configFiles, entries, sourceHashes)
	status := projectNativeStaticCacheStatus{
		CacheHits:    []string{},
		CacheMisses:  []string{},
		CacheEntries: []devtools.StaticCacheHit{},
	}
	for _, fileStatus := range statuses {
		if !fileStatus.Hit {
			status.CacheMisses = append(status.CacheMisses, fileStatus.File)
			continue
		}
		status.CacheHits = append(status.CacheHits, fileStatus.File)
		status.CacheEntries = append(status.CacheEntries, devtools.StaticCacheHit{
			File:            fileStatus.File,
			CacheKey:        fileStatus.Entry.CacheKey,
			SourceHash:      fileStatus.Entry.SourceHash,
			SemanticProfile: fileStatus.Extraction.SemanticProfile,
		})
	}
	return status
}

type projectNativeStaticCacheManifestHitInput struct {
	Root           string
	File           string
	CompilerInputs []json.RawMessage
	ConfigFiles    []projectNativeStaticParseCacheSourceHash
	Entries        map[string]projectNativeStaticParseCacheManifestEntry
	SourceHashes   *projectNativeStaticSourceHashMemo
}

func projectNativeStaticCacheManifestHit(
	input projectNativeStaticCacheManifestHitInput,
) (projectNativeStaticParseCacheManifestEntry, projectNativeStaticCachedExtraction, bool) {
	identity := projectNativeStaticCacheManifestIdentity(input.Root, input.File, input.CompilerInputs)
	entry, ok := input.Entries[identity]
	if !ok {
		return projectNativeStaticParseCacheManifestEntry{}, projectNativeStaticCachedExtraction{}, false
	}
	sourceHash, ok := input.SourceHashes.Read(input.File)
	if !ok || entry.SourceHash != sourceHash {
		return projectNativeStaticParseCacheManifestEntry{}, projectNativeStaticCachedExtraction{}, false
	}
	if !projectNativeStaticSourceHashesEqual(entry.ConfigFiles, input.ConfigFiles) {
		return projectNativeStaticParseCacheManifestEntry{}, projectNativeStaticCachedExtraction{}, false
	}
	for _, dependency := range entry.Dependencies {
		hash, ok := input.SourceHashes.Read(filepath.Join(input.Root, filepath.FromSlash(dependency.File)))
		if !ok || dependency.SourceHash != hash {
			return projectNativeStaticParseCacheManifestEntry{}, projectNativeStaticCachedExtraction{}, false
		}
	}
	extraction, err := projectNativeStaticReadCachedExtraction(input.Root, entry.CacheKey)
	if err != nil {
		return projectNativeStaticParseCacheManifestEntry{}, projectNativeStaticCachedExtraction{}, false
	}
	if !projectNativeStaticCachedExtractionMatchesManifest(input.File, entry.SourceHash, extraction) {
		return projectNativeStaticParseCacheManifestEntry{}, projectNativeStaticCachedExtraction{}, false
	}
	return entry, extraction, true
}

func projectNativeStaticReadCacheManifestEntries(
	root string,
	wantedIdentities map[string]bool,
) map[string]projectNativeStaticParseCacheManifestEntry {
	entries := map[string]projectNativeStaticParseCacheManifestEntry{}
	data, err := os.ReadFile(projectNativeStaticCacheManifestLogFile(root))
	if err != nil {
		return entries
	}
	lines := strings.Split(string(data), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		line := lines[index]
		if strings.TrimSpace(line) == "" {
			continue
		}
		var entry projectNativeStaticParseCacheManifestEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil || !projectNativeStaticValidCacheManifestEntry(root, entry) {
			continue
		}
		identity := projectNativeStaticCacheManifestIdentity(root, entry.File, entry.CompilerInputs)
		if !wantedIdentities[identity] {
			continue
		}
		if _, exists := entries[identity]; exists {
			continue
		}
		entries[identity] = entry
		if len(entries) == len(wantedIdentities) {
			break
		}
	}
	return entries
}

func projectNativeStaticCacheManifestIdentities(
	root string,
	files []string,
	compilerInputs []json.RawMessage,
) map[string]bool {
	identities := make(map[string]bool, len(files))
	for _, file := range files {
		identities[projectNativeStaticCacheManifestIdentity(root, file, compilerInputs)] = true
	}
	return identities
}

func projectNativeStaticValidCacheManifestEntry(root string, entry projectNativeStaticParseCacheManifestEntry) bool {
	return entry.Version == projectNativeStaticParseCacheEpoch &&
		entry.Root == root &&
		entry.File != "" &&
		entry.SourceHash != "" &&
		entry.CacheKey != "" &&
		entry.Dependencies != nil &&
		entry.ConfigFiles != nil &&
		entry.CompilerInputs != nil
}

func projectNativeStaticCacheManifestLogFile(root string) string {
	return filepath.Join(root, ".crux", "cache", "index", projectNativeStaticParseCacheEpoch, "manifest.jsonl")
}

func projectNativeStaticCacheManifestIdentity(root string, file string, compilerInputs []json.RawMessage) string {
	relativeFile := filepath.ToSlash(file)
	if strings.HasPrefix(file, root) {
		if relative, err := filepath.Rel(root, file); err == nil {
			relativeFile = filepath.ToSlash(relative)
		}
	}
	data, _ := json.Marshal(struct {
		Version        string            `json:"version"`
		Root           string            `json:"root"`
		File           string            `json:"file"`
		CompilerInputs []json.RawMessage `json:"compilerInputs"`
	}{
		Version:        projectNativeStaticParseCacheEpoch,
		Root:           root,
		File:           relativeFile,
		CompilerInputs: compilerInputs,
	})
	return string(data)
}

func projectNativeStaticReadConfigFileHashes(root string) []projectNativeStaticParseCacheSourceHash {
	out := []projectNativeStaticParseCacheSourceHash{}
	for _, name := range []string{"jsconfig.json", "tsconfig.json"} {
		if hash, ok := projectNativeStaticSourceHash(filepath.Join(root, name), nil); ok {
			out = append(out, projectNativeStaticParseCacheSourceHash{File: name, SourceHash: hash})
		}
	}
	return out
}

func projectNativeStaticSourceHash(file string, memo map[string]string) (string, bool) {
	if memo != nil {
		if hash, ok := memo[file]; ok {
			return hash, true
		}
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return "", false
	}
	sum := sha256.Sum256(data)
	hash := fmt.Sprintf("%x", sum)
	if memo != nil {
		memo[file] = hash
	}
	return hash, true
}

func projectNativeStaticSourceHashesEqual(left, right []projectNativeStaticParseCacheSourceHash) bool {
	left = append([]projectNativeStaticParseCacheSourceHash(nil), left...)
	right = append([]projectNativeStaticParseCacheSourceHash(nil), right...)
	sort.Slice(left, func(i, j int) bool { return left[i].File < left[j].File })
	sort.Slice(right, func(i, j int) bool { return right[i].File < right[j].File })
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func projectNativeStaticCacheFileForIdentity(root string, cacheKey string) string {
	cacheKeyJSON, _ := json.Marshal(cacheKey)
	sum := sha256.Sum256(cacheKeyJSON)
	return filepath.Join(root, ".crux", "cache", "index", projectNativeStaticParseCacheEpoch, fmt.Sprintf("%x.json", sum))
}

func projectNativeStaticFilesToParseFromCacheStatus(cacheMisses, files, primaryFiles []string) []string {
	if len(cacheMisses) == 0 {
		return []string{}
	}
	primary := make(map[string]bool, len(primaryFiles))
	for _, file := range primaryFiles {
		primary[file] = true
	}
	selected := map[string]bool{}
	for _, file := range cacheMisses {
		if file != "" {
			selected[file] = true
		}
	}
	for _, file := range files {
		if file != "" && !primary[file] {
			selected[file] = true
		}
	}
	out := make([]string, 0, len(selected))
	for file := range selected {
		out = append(out, file)
	}
	sort.Strings(out)
	return out
}
