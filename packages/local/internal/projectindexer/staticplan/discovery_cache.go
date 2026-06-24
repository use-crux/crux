package staticplan

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"sync"
	"time"
)

const (
	projectNativeStaticDiscoveryCacheVersion    = "native-static-discovery-v2"
	projectNativeStaticClassifierCacheVersion   = "classifier-v1"
	projectNativeStaticImportScanCacheVersion   = "import-scan-v1"
	projectNativeStaticDiscoveryCacheResultFile = "source-selection.json"
)

type projectNativeStaticDiscoveryCache struct {
	root string
	file string

	mu    sync.Mutex
	data  projectNativeStaticDiscoveryCacheData
	dirty bool
}

type projectNativeStaticDiscoveryCacheData struct {
	Version         string                                               `json:"version"`
	Root            string                                               `json:"root"`
	Classifications map[string]projectNativeStaticCachedClassification   `json:"classifications"`
	Imports         map[string]projectNativeStaticCachedImportResolution `json:"imports"`
}

type projectNativeStaticCachedClassification struct {
	Version      string                                      `json:"version"`
	File         string                                      `json:"file"`
	CallNamesKey string                                      `json:"callNamesKey"`
	Fingerprint  projectNativeStaticDiscoveryFileFingerprint `json:"fingerprint"`
	Result       projectNativeStaticCandidateClassification  `json:"result"`
}

type projectNativeStaticCachedImportResolution struct {
	Version          string                                      `json:"version"`
	File             string                                      `json:"file"`
	Fingerprint      projectNativeStaticDiscoveryFileFingerprint `json:"fingerprint"`
	Dependencies     []string                                    `json:"dependencies"`
	ResolutionChecks []projectNativeStaticDiscoveryPathState     `json:"resolutionChecks"`
}

type projectNativeStaticDiscoveryFileFingerprint struct {
	Size               int64 `json:"size"`
	ModTimeUnixNano    int64 `json:"modTimeUnixNano"`
	ChangeTimeUnixNano int64 `json:"changeTimeUnixNano,omitempty"`
}

type projectNativeStaticDiscoveryPathState struct {
	File               string `json:"file"`
	Exists             bool   `json:"exists"`
	IsDir              bool   `json:"isDir,omitempty"`
	SourceFile         bool   `json:"sourceFile,omitempty"`
	Size               int64  `json:"size,omitempty"`
	ModTimeUnixNano    int64  `json:"modTimeUnixNano,omitempty"`
	ChangeTimeUnixNano int64  `json:"changeTimeUnixNano,omitempty"`
}

func projectNativeStaticLoadDiscoveryCache(root string) *projectNativeStaticDiscoveryCache {
	cacheFile := filepath.Join(root, ".crux", "cache", "index", projectNativeStaticDiscoveryCacheVersion, projectNativeStaticDiscoveryCacheResultFile)
	cache := &projectNativeStaticDiscoveryCache{
		root: root,
		file: cacheFile,
		data: projectNativeStaticDiscoveryCacheData{
			Version:         projectNativeStaticDiscoveryCacheVersion,
			Root:            root,
			Classifications: map[string]projectNativeStaticCachedClassification{},
			Imports:         map[string]projectNativeStaticCachedImportResolution{},
		},
	}
	data, err := os.ReadFile(cacheFile)
	if err != nil {
		return cache
	}
	var decoded projectNativeStaticDiscoveryCacheData
	if err := json.Unmarshal(data, &decoded); err != nil ||
		decoded.Version != projectNativeStaticDiscoveryCacheVersion ||
		decoded.Root != root {
		return cache
	}
	cache.data = decoded
	if cache.data.Classifications == nil {
		cache.data.Classifications = map[string]projectNativeStaticCachedClassification{}
	}
	if cache.data.Imports == nil {
		cache.data.Imports = map[string]projectNativeStaticCachedImportResolution{}
	}
	return cache
}

func (cache *projectNativeStaticDiscoveryCache) Save() {
	if cache == nil {
		return
	}
	cache.mu.Lock()
	if !cache.dirty {
		cache.mu.Unlock()
		return
	}
	cache.data.Version = projectNativeStaticDiscoveryCacheVersion
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

func (cache *projectNativeStaticDiscoveryCache) CachedClassification(
	file string,
	callNamesKey string,
) (projectNativeStaticCandidateClassification, bool) {
	fingerprint, ok := projectNativeStaticDiscoveryFingerprint(file)
	return cache.CachedClassificationWithFingerprint(file, callNamesKey, fingerprint, ok)
}

func (cache *projectNativeStaticDiscoveryCache) CachedClassificationWithFingerprint(
	file string,
	callNamesKey string,
	fingerprint projectNativeStaticDiscoveryFileFingerprint,
	fingerprintOK bool,
) (projectNativeStaticCandidateClassification, bool) {
	if cache == nil || !fingerprintOK {
		return projectNativeStaticCandidateClassification{}, false
	}
	relativeFile := cache.relativeFile(file)
	key := projectNativeStaticDiscoveryClassificationKey(relativeFile, callNamesKey)
	cache.mu.Lock()
	entry, ok := cache.data.Classifications[key]
	cache.mu.Unlock()
	if !ok ||
		entry.Version != projectNativeStaticClassifierCacheVersion ||
		entry.File != relativeFile ||
		entry.CallNamesKey != callNamesKey ||
		entry.Fingerprint != fingerprint {
		return projectNativeStaticCandidateClassification{}, false
	}
	result := entry.Result
	result.File = file
	result.Bytes = fingerprint.Size
	return result, true
}

func (cache *projectNativeStaticDiscoveryCache) StoreClassification(
	file string,
	callNamesKey string,
	result projectNativeStaticCandidateClassification,
) {
	fingerprint, ok := projectNativeStaticDiscoveryFingerprint(file)
	cache.StoreClassificationWithFingerprint(file, callNamesKey, result, fingerprint, ok)
}

func (cache *projectNativeStaticDiscoveryCache) StoreClassificationWithFingerprint(
	file string,
	callNamesKey string,
	result projectNativeStaticCandidateClassification,
	fingerprint projectNativeStaticDiscoveryFileFingerprint,
	fingerprintOK bool,
) {
	if cache == nil || !fingerprintOK {
		return
	}
	relativeFile := cache.relativeFile(file)
	stored := result
	stored.File = relativeFile
	stored.Bytes = fingerprint.Size
	key := projectNativeStaticDiscoveryClassificationKey(relativeFile, callNamesKey)
	cache.mu.Lock()
	cache.data.Classifications[key] = projectNativeStaticCachedClassification{
		Version:      projectNativeStaticClassifierCacheVersion,
		File:         relativeFile,
		CallNamesKey: callNamesKey,
		Fingerprint:  fingerprint,
		Result:       stored,
	}
	cache.dirty = true
	cache.mu.Unlock()
}

func (cache *projectNativeStaticDiscoveryCache) CachedImports(file string) ([]string, bool) {
	fingerprint, ok := projectNativeStaticDiscoveryFingerprint(file)
	return cache.CachedImportsWithFingerprint(file, fingerprint, ok)
}

func (cache *projectNativeStaticDiscoveryCache) CachedImportsWithFingerprint(
	file string,
	fingerprint projectNativeStaticDiscoveryFileFingerprint,
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
		entry.Version != projectNativeStaticImportScanCacheVersion ||
		entry.File != relativeFile ||
		entry.Fingerprint != fingerprint {
		return nil, false
	}
	for _, expected := range entry.ResolutionChecks {
		if !projectNativeStaticDiscoveryPathStateMatches(cache.root, expected) {
			return nil, false
		}
	}
	dependencies := make([]string, 0, len(entry.Dependencies))
	for _, dependency := range entry.Dependencies {
		dependencies = append(dependencies, filepath.Join(cache.root, filepath.FromSlash(dependency)))
	}
	return dependencies, true
}

func (cache *projectNativeStaticDiscoveryCache) StoreImports(
	file string,
	dependencies []string,
	resolutionChecks []projectNativeStaticDiscoveryPathState,
) {
	fingerprint, ok := projectNativeStaticDiscoveryFingerprint(file)
	cache.StoreImportsWithFingerprint(file, dependencies, resolutionChecks, fingerprint, ok)
}

func (cache *projectNativeStaticDiscoveryCache) StoreImportsWithFingerprint(
	file string,
	dependencies []string,
	resolutionChecks []projectNativeStaticDiscoveryPathState,
	fingerprint projectNativeStaticDiscoveryFileFingerprint,
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
	relativeChecks := make([]projectNativeStaticDiscoveryPathState, 0, len(resolutionChecks))
	for _, check := range resolutionChecks {
		check.File = cache.relativeFile(check.File)
		relativeChecks = append(relativeChecks, check)
	}
	relativeFile := cache.relativeFile(file)
	cache.mu.Lock()
	cache.data.Imports[relativeFile] = projectNativeStaticCachedImportResolution{
		Version:          projectNativeStaticImportScanCacheVersion,
		File:             relativeFile,
		Fingerprint:      fingerprint,
		Dependencies:     relativeDependencies,
		ResolutionChecks: relativeChecks,
	}
	cache.dirty = true
	cache.mu.Unlock()
}

func (cache *projectNativeStaticDiscoveryCache) relativeFile(file string) string {
	if relative, err := filepath.Rel(cache.root, file); err == nil {
		return filepath.ToSlash(relative)
	}
	return filepath.ToSlash(file)
}

func projectNativeStaticDiscoveryFingerprint(file string) (projectNativeStaticDiscoveryFileFingerprint, bool) {
	info, err := os.Stat(file)
	if err != nil || info.IsDir() {
		return projectNativeStaticDiscoveryFileFingerprint{}, false
	}
	return projectNativeStaticDiscoveryFileFingerprint{
		Size:               info.Size(),
		ModTimeUnixNano:    info.ModTime().UnixNano(),
		ChangeTimeUnixNano: projectNativeStaticChangeTimeUnixNano(info),
	}, true
}

func projectNativeStaticChangeTimeUnixNano(info os.FileInfo) int64 {
	if info == nil || info.Sys() == nil {
		return 0
	}
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return 0
		}
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return 0
	}
	for _, name := range []string{"Ctim", "Ctimespec"} {
		field := value.FieldByName(name)
		if timestamp, ok := projectNativeStaticUnixTimeField(field); ok {
			return timestamp
		}
	}
	return 0
}

func projectNativeStaticUnixTimeField(value reflect.Value) (int64, bool) {
	if !value.IsValid() {
		return 0, false
	}
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return 0, false
		}
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return 0, false
	}
	sec, ok := projectNativeStaticIntField(value, "Sec")
	if !ok {
		return 0, false
	}
	nsec, ok := projectNativeStaticIntField(value, "Nsec")
	if !ok {
		nsec, ok = projectNativeStaticIntField(value, "Nsec")
	}
	if !ok {
		return 0, false
	}
	return sec*int64(time.Second) + nsec, true
}

func projectNativeStaticIntField(value reflect.Value, name string) (int64, bool) {
	field := value.FieldByName(name)
	if !field.IsValid() {
		return 0, false
	}
	switch field.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return field.Int(), true
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		unsigned := field.Uint()
		if unsigned > uint64(^uint64(0)>>1) {
			return 0, false
		}
		return int64(unsigned), true
	default:
		return 0, false
	}
}

func projectNativeStaticReadDiscoveryPathState(root string, file string) projectNativeStaticDiscoveryPathState {
	state := projectNativeStaticDiscoveryPathState{File: filepath.ToSlash(file)}
	if root != "" {
		if relative, err := filepath.Rel(root, file); err == nil {
			state.File = filepath.ToSlash(relative)
		}
	}
	info, err := os.Stat(file)
	if err != nil {
		return state
	}
	state.Exists = true
	state.IsDir = info.IsDir()
	state.SourceFile = !info.IsDir() && projectNativeStaticCandidateSourceFile(file)
	state.Size = info.Size()
	state.ModTimeUnixNano = info.ModTime().UnixNano()
	state.ChangeTimeUnixNano = projectNativeStaticChangeTimeUnixNano(info)
	return state
}

func projectNativeStaticDiscoveryPathStateMatches(root string, expected projectNativeStaticDiscoveryPathState) bool {
	file := expected.File
	if root != "" && !filepath.IsAbs(file) {
		file = filepath.Join(root, filepath.FromSlash(file))
	}
	return projectNativeStaticReadDiscoveryPathState(root, file) == expected
}
