package planner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

const (
	discoveryCacheVersion    = "static-index-discovery-v2"
	classifierCacheVersion   = "classifier-v1"
	importScanCacheVersion   = "import-scan-v1"
	discoveryCacheResultFile = "source-selection.json"
)

type discoveryCache struct {
	root string
	file string

	mu    sync.Mutex
	data  discoveryCacheData
	dirty bool
}

type discoveryCacheData struct {
	Version         string                            `json:"version"`
	Root            string                            `json:"root"`
	Classifications map[string]cachedClassification   `json:"classifications"`
	Imports         map[string]cachedImportResolution `json:"imports"`
}

type cachedClassification struct {
	Version      string                   `json:"version"`
	File         string                   `json:"file"`
	CallNamesKey string                   `json:"callNamesKey"`
	Fingerprint  discoveryFileFingerprint `json:"fingerprint"`
	Result       candidateClassification  `json:"result"`
}

type cachedImportResolution struct {
	Version          string                   `json:"version"`
	File             string                   `json:"file"`
	Fingerprint      discoveryFileFingerprint `json:"fingerprint"`
	Dependencies     []string                 `json:"dependencies"`
	ResolutionChecks []discoveryPathState     `json:"resolutionChecks"`
}

func loadDiscoveryCache(root string) *discoveryCache {
	cacheFile := filepath.Join(root, ".crux", "cache", "index", discoveryCacheVersion, discoveryCacheResultFile)
	cache := &discoveryCache{
		root: root,
		file: cacheFile,
		data: discoveryCacheData{
			Version:         discoveryCacheVersion,
			Root:            root,
			Classifications: map[string]cachedClassification{},
			Imports:         map[string]cachedImportResolution{},
		},
	}
	data, err := os.ReadFile(cacheFile)
	if err != nil {
		return cache
	}
	var decoded discoveryCacheData
	if err := json.Unmarshal(data, &decoded); err != nil ||
		decoded.Version != discoveryCacheVersion ||
		decoded.Root != root {
		return cache
	}
	cache.data = decoded
	if cache.data.Classifications == nil {
		cache.data.Classifications = map[string]cachedClassification{}
	}
	if cache.data.Imports == nil {
		cache.data.Imports = map[string]cachedImportResolution{}
	}
	cache.evictMissingFiles()
	return cache
}

func (cache *discoveryCache) evictMissingFiles() {
	for key, entry := range cache.data.Classifications {
		if cache.sourceFileMissing(entry.File) {
			delete(cache.data.Classifications, key)
			cache.dirty = true
		}
	}
	for key, entry := range cache.data.Imports {
		missing := cache.sourceFileMissing(entry.File)
		for _, dependency := range entry.Dependencies {
			missing = missing || cache.sourceFileMissing(dependency)
		}
		if missing {
			delete(cache.data.Imports, key)
			cache.dirty = true
		}
	}
}

func (cache *discoveryCache) sourceFileMissing(file string) bool {
	if !filepath.IsAbs(file) {
		file = filepath.Join(cache.root, filepath.FromSlash(file))
	}
	info, err := os.Stat(file)
	if err != nil {
		return os.IsNotExist(err)
	}
	return info.IsDir()
}

func (cache *discoveryCache) Save() {
	if cache == nil {
		return
	}
	cache.mu.Lock()
	if !cache.dirty {
		cache.mu.Unlock()
		return
	}
	cache.data.Version = discoveryCacheVersion
	cache.data.Root = cache.root
	data, err := json.Marshal(cache.data)
	cache.mu.Unlock()
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(cache.file), 0o755); err != nil {
		return
	}
	tmp := cache.file + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	if err := os.Rename(tmp, cache.file); err != nil {
		_ = os.Remove(tmp)
	}
}

func (cache *discoveryCache) CachedClassification(
	file string,
	callNamesKey string,
) (candidateClassification, bool) {
	fingerprint, ok := discoveryFingerprint(file)
	return cache.CachedClassificationWithFingerprint(file, callNamesKey, fingerprint, ok)
}

func (cache *discoveryCache) CachedClassificationWithFingerprint(
	file string,
	callNamesKey string,
	fingerprint discoveryFileFingerprint,
	fingerprintOK bool,
) (candidateClassification, bool) {
	if cache == nil || !fingerprintOK {
		return candidateClassification{}, false
	}
	relativeFile := cache.relativeFile(file)
	key := discoveryClassificationKey(relativeFile, callNamesKey)
	cache.mu.Lock()
	entry, ok := cache.data.Classifications[key]
	cache.mu.Unlock()
	if !ok ||
		entry.Version != classifierCacheVersion ||
		entry.File != relativeFile ||
		entry.CallNamesKey != callNamesKey ||
		entry.Fingerprint != fingerprint {
		return candidateClassification{}, false
	}
	result := entry.Result
	result.File = file
	result.Bytes = fingerprint.Size
	return result, true
}

func (cache *discoveryCache) StoreClassification(
	file string,
	callNamesKey string,
	result candidateClassification,
) {
	fingerprint, ok := discoveryFingerprint(file)
	cache.StoreClassificationWithFingerprint(file, callNamesKey, result, fingerprint, ok)
}

func (cache *discoveryCache) StoreClassificationWithFingerprint(
	file string,
	callNamesKey string,
	result candidateClassification,
	fingerprint discoveryFileFingerprint,
	fingerprintOK bool,
) {
	if cache == nil || !fingerprintOK {
		return
	}
	relativeFile := cache.relativeFile(file)
	stored := result
	stored.File = relativeFile
	stored.Bytes = fingerprint.Size
	key := discoveryClassificationKey(relativeFile, callNamesKey)
	cache.mu.Lock()
	cache.data.Classifications[key] = cachedClassification{
		Version:      classifierCacheVersion,
		File:         relativeFile,
		CallNamesKey: callNamesKey,
		Fingerprint:  fingerprint,
		Result:       stored,
	}
	cache.dirty = true
	cache.mu.Unlock()
}

func (cache *discoveryCache) CachedImports(file string) ([]string, bool) {
	fingerprint, ok := discoveryFingerprint(file)
	return cache.CachedImportsWithFingerprint(file, fingerprint, ok)
}

func (cache *discoveryCache) CachedImportsWithFingerprint(
	file string,
	fingerprint discoveryFileFingerprint,
	fingerprintOK bool,
) ([]string, bool) {
	if cache == nil || !fingerprintOK {
		return nil, false
	}
	relativeFile := cache.relativeFile(file)
	cache.mu.Lock()
	entry, ok := cache.data.Imports[relativeFile]
	cache.mu.Unlock()
	if !ok ||
		entry.Version != importScanCacheVersion ||
		entry.File != relativeFile ||
		entry.Fingerprint != fingerprint {
		return nil, false
	}
	for _, expected := range entry.ResolutionChecks {
		if !discoveryPathStateMatches(cache.root, expected) {
			return nil, false
		}
	}
	dependencies := make([]string, 0, len(entry.Dependencies))
	for _, dependency := range entry.Dependencies {
		dependencies = append(dependencies, filepath.Join(cache.root, filepath.FromSlash(dependency)))
	}
	return dependencies, true
}

func (cache *discoveryCache) StoreImports(
	file string,
	dependencies []string,
	resolutionChecks []discoveryPathState,
) {
	fingerprint, ok := discoveryFingerprint(file)
	cache.StoreImportsWithFingerprint(file, dependencies, resolutionChecks, fingerprint, ok)
}

func (cache *discoveryCache) StoreImportsWithFingerprint(
	file string,
	dependencies []string,
	resolutionChecks []discoveryPathState,
	fingerprint discoveryFileFingerprint,
	fingerprintOK bool,
) {
	if cache == nil || !fingerprintOK {
		return
	}
	relativeDependencies := make([]string, 0, len(dependencies))
	for _, dependency := range dependencies {
		relativeDependencies = append(relativeDependencies, cache.relativeFile(dependency))
	}
	sort.Strings(relativeDependencies)
	relativeChecks := make([]discoveryPathState, 0, len(resolutionChecks))
	for _, check := range resolutionChecks {
		check.File = cache.relativeFile(check.File)
		relativeChecks = append(relativeChecks, check)
	}
	relativeFile := cache.relativeFile(file)
	cache.mu.Lock()
	cache.data.Imports[relativeFile] = cachedImportResolution{
		Version:          importScanCacheVersion,
		File:             relativeFile,
		Fingerprint:      fingerprint,
		Dependencies:     relativeDependencies,
		ResolutionChecks: relativeChecks,
	}
	cache.dirty = true
	cache.mu.Unlock()
}

func (cache *discoveryCache) relativeFile(file string) string {
	if relative, err := filepath.Rel(cache.root, file); err == nil {
		return filepath.ToSlash(relative)
	}
	return filepath.ToSlash(file)
}
