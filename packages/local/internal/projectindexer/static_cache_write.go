package projectindexer

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type projectNativeStaticParseCacheEntryMetadata struct {
	Version        string                                    `json:"version"`
	Root           string                                    `json:"root"`
	File           string                                    `json:"file"`
	SourceHash     string                                    `json:"sourceHash"`
	Dependencies   []projectNativeStaticParseCacheSourceHash `json:"dependencies"`
	ConfigFiles    []projectNativeStaticParseCacheSourceHash `json:"configFiles"`
	CompilerInputs []json.RawMessage                         `json:"compilerInputs"`
}

type projectNativeStaticWritableCacheExtraction struct {
	File            string                              `json:"file"`
	Definitions     []store.ProjectDefinition           `json:"definitions"`
	Relations       []store.ProjectRelation             `json:"relations"`
	Diagnostics     []store.IndexDiagnostic             `json:"diagnostics"`
	Dependencies    []string                            `json:"dependencies"`
	SemanticProfile *devtools.SemanticSourceProfileFile `json:"semanticProfile,omitempty"`
}

func projectNativeStaticWriteCacheFromPatch(
	root string,
	cacheInputs []json.RawMessage,
	sourceInput projectNativeStaticSourceInput,
	plan projectNativeStaticPlan,
	patch devtools.IndexPatch,
) {
	if len(cacheInputs) == 0 {
		return
	}
	primaryMisses := projectNativeStaticWritablePrimaryMisses(plan)
	if len(primaryMisses) == 0 {
		return
	}

	sourceFiles := projectNativeStaticSourceFileMap(sourceInput.Files)
	sourceProfiles := projectNativeStaticSemanticProfileMap(sourceInput.SemanticSourceProfile)
	sources := projectNativeStaticPatchSourceMap(patch.Facts.Sources)
	configFiles := projectNativeStaticReadConfigFileHashes(root)

	for _, file := range primaryMisses {
		source, ok := sources[file]
		if !ok {
			continue
		}
		sourceFile, ok := sourceFiles[file]
		if !ok {
			continue
		}
		write := projectNativeStaticCacheWriteForFile{
			Root:            root,
			File:            file,
			SourceHash:      sourceFile.SourceHash,
			Source:          source,
			ConfigFiles:     configFiles,
			CompilerInputs:  cacheInputs,
			SemanticProfile: sourceProfiles[file],
			Patch:           patch.Facts,
		}
		_ = projectNativeStaticWriteCacheFile(write)
	}
}

type projectNativeStaticCacheWriteForFile struct {
	Root            string
	File            string
	SourceHash      string
	Source          store.IndexSourceFile
	ConfigFiles     []projectNativeStaticParseCacheSourceHash
	CompilerInputs  []json.RawMessage
	SemanticProfile *devtools.SemanticSourceProfileFile
	Patch           devtools.IndexPatchFacts
}

func projectNativeStaticWriteCacheFile(input projectNativeStaticCacheWriteForFile) error {
	dependencies, err := projectNativeStaticParseCacheDependencyHashes(input.Root, input.Source.Dependencies)
	if err != nil {
		return err
	}
	metadata := projectNativeStaticParseCacheEntryMetadata{
		Version:        projectNativeStaticParseCacheEpoch,
		Root:           input.Root,
		File:           projectNativeStaticRelativeFile(input.Root, input.File),
		SourceHash:     input.SourceHash,
		Dependencies:   dependencies,
		ConfigFiles:    input.ConfigFiles,
		CompilerInputs: append([]json.RawMessage(nil), input.CompilerInputs...),
	}
	cacheKeyData, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	cacheKey := string(cacheKeyData)
	extraction := projectNativeStaticCacheExtractionForFile(input)
	if err := projectNativeStaticWriteCacheExtraction(input.Root, cacheKey, extraction); err != nil {
		return err
	}
	return projectNativeStaticAppendCacheManifestEntry(input.Root, cacheKey, metadata)
}

func projectNativeStaticCacheExtractionForFile(input projectNativeStaticCacheWriteForFile) projectNativeStaticWritableCacheExtraction {
	definitionIDs := projectNativeStaticDefinitionIDSet(input.Source.DefinitionIDs)
	definitions := projectNativeStaticDefinitionsForCache(input.File, definitionIDs, input.Patch.Definitions)
	if len(definitionIDs) == 0 {
		definitionIDs = projectNativeStaticDefinitionIDs(definitions)
	}
	return projectNativeStaticWritableCacheExtraction{
		File:            input.File,
		Definitions:     definitions,
		Relations:       projectNativeStaticRelationsForCache(input.File, definitionIDs, input.Patch.Relations),
		Diagnostics:     projectNativeStaticDiagnosticsForCache(input.File, definitionIDs, input.Source.Diagnostics, input.Patch.Diagnostics),
		Dependencies:    projectNativeStaticUniqueStrings(input.Source.Dependencies),
		SemanticProfile: input.SemanticProfile,
	}
}

func projectNativeStaticWriteCacheExtraction(root string, cacheKey string, extraction projectNativeStaticWritableCacheExtraction) error {
	data, err := json.Marshal(extraction)
	if err != nil {
		return err
	}
	file := projectNativeStaticCacheFileForIdentity(root, cacheKey)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return os.WriteFile(file, data, 0o600)
}

func projectNativeStaticAppendCacheManifestEntry(
	root string,
	cacheKey string,
	metadata projectNativeStaticParseCacheEntryMetadata,
) error {
	entry := projectNativeStaticParseCacheManifestEntry{
		Version:        metadata.Version,
		Root:           metadata.Root,
		File:           metadata.File,
		SourceHash:     metadata.SourceHash,
		Dependencies:   metadata.Dependencies,
		ConfigFiles:    metadata.ConfigFiles,
		CompilerInputs: metadata.CompilerInputs,
		CacheKey:       cacheKey,
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	file := projectNativeStaticCacheManifestLogFile(root)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	handle, err := os.OpenFile(file, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer handle.Close()
	if _, err := handle.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}

func projectNativeStaticParseCacheDependencyHashes(
	root string,
	dependencies []string,
) ([]projectNativeStaticParseCacheSourceHash, error) {
	dependencies = projectNativeStaticUniqueStrings(dependencies)
	out := make([]projectNativeStaticParseCacheSourceHash, 0, len(dependencies))
	for _, dependency := range dependencies {
		file := dependency
		if !filepath.IsAbs(file) {
			file = filepath.Join(root, filepath.FromSlash(file))
		}
		hash, ok := projectNativeStaticSourceHash(file, nil)
		if !ok {
			return nil, fmt.Errorf("hash dependency %s", dependency)
		}
		out = append(out, projectNativeStaticParseCacheSourceHash{
			File:       projectNativeStaticRelativeFile(root, file),
			SourceHash: hash,
		})
	}
	return out, nil
}

func projectNativeStaticRelativeFile(root string, file string) string {
	if relative, err := filepath.Rel(root, file); err == nil && !filepath.IsAbs(relative) {
		return filepath.ToSlash(relative)
	}
	return filepath.ToSlash(file)
}
