package cache

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type entryMetadata struct {
	Version        string             `json:"version"`
	Root           string             `json:"root"`
	File           string             `json:"file"`
	SourceHash     string             `json:"sourceHash"`
	Dependencies   []sourceHashRecord `json:"dependencies"`
	ConfigFiles    []sourceHashRecord `json:"configFiles"`
	CompilerInputs []json.RawMessage  `json:"compilerInputs"`
}

type WritableExtraction struct {
	File            string                                  `json:"file"`
	Definitions     []store.ProjectDefinition               `json:"definitions"`
	Relations       []store.ProjectRelation                 `json:"relations"`
	Diagnostics     []store.IndexDiagnostic                 `json:"diagnostics"`
	Dependencies    []string                                `json:"dependencies"`
	SemanticProfile *projectindex.SemanticSourceProfileFile `json:"semanticProfile,omitempty"`
}

func WriteFromPatch(
	root string,
	cacheInputs []json.RawMessage,
	sourceInput SourceInput,
	plan protocol.Plan,
	patch projectindex.IndexPatch,
) {
	if len(cacheInputs) == 0 {
		return
	}
	primaryMisses := writablePrimaryMisses(plan)
	if len(primaryMisses) == 0 {
		return
	}

	sourceFiles := sourceFileMap(sourceInput.Files)
	sourceProfiles := semanticProfileMap(sourceInput.SemanticSourceProfile)
	sources := patchSourceMap(patch.Facts.Sources)
	configFiles := readConfigFileHashes(root)

	for _, file := range primaryMisses {
		source, ok := sources[file]
		if !ok {
			continue
		}
		sourceFile, ok := sourceFiles[file]
		if !ok {
			continue
		}
		write := writeForFile{
			Root:            root,
			File:            file,
			SourceHash:      sourceFile.SourceHash,
			Source:          source,
			ConfigFiles:     configFiles,
			CompilerInputs:  cacheInputs,
			SemanticProfile: sourceProfiles[file],
			Patch:           patch.Facts,
		}
		_ = writeFile(write)
	}
}

type writeForFile struct {
	Root            string
	File            string
	SourceHash      string
	Source          store.IndexSourceFile
	ConfigFiles     []sourceHashRecord
	CompilerInputs  []json.RawMessage
	SemanticProfile *projectindex.SemanticSourceProfileFile
	Patch           projectindex.IndexPatchFacts
}

func writeFile(input writeForFile) error {
	dependencies, err := dependencyHashes(input.Root, input.Source.Dependencies)
	if err != nil {
		return err
	}
	metadata := entryMetadata{
		Version:        Epoch,
		Root:           input.Root,
		File:           relativeFile(input.Root, input.File),
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
	extraction := extractionForFile(input)
	if err := WriteExtraction(input.Root, cacheKey, extraction); err != nil {
		return err
	}
	return appendManifestEntry(input.Root, cacheKey, metadata)
}

func extractionForFile(input writeForFile) WritableExtraction {
	ids := definitionIDSet(input.Source.DefinitionIDs)
	definitions := definitionsForCache(input.File, ids, input.Patch.Definitions)
	if len(ids) == 0 {
		ids = definitionIDs(definitions)
	}
	return WritableExtraction{
		File:            input.File,
		Definitions:     definitions,
		Relations:       relationsForCache(input.File, ids, input.Patch.Relations),
		Diagnostics:     diagnosticsForCache(input.File, ids, input.Source.Diagnostics, input.Patch.Diagnostics),
		Dependencies:    uniqueStrings(input.Source.Dependencies),
		SemanticProfile: input.SemanticProfile,
	}
}

func WriteExtraction(root string, cacheKey string, extraction WritableExtraction) error {
	data, err := json.Marshal(extraction)
	if err != nil {
		return err
	}
	file := FileForIdentity(root, cacheKey)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return os.WriteFile(file, data, 0o600)
}

func appendManifestEntry(
	root string,
	cacheKey string,
	metadata entryMetadata,
) error {
	entry := manifestEntry{
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
	file := manifestLogFile(root)
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

func dependencyHashes(
	root string,
	dependencies []string,
) ([]sourceHashRecord, error) {
	dependencies = uniqueStrings(dependencies)
	out := make([]sourceHashRecord, 0, len(dependencies))
	for _, dependency := range dependencies {
		file := dependency
		if !filepath.IsAbs(file) {
			file = filepath.Join(root, filepath.FromSlash(file))
		}
		hash, ok := sourceHash(file, nil)
		if !ok {
			return nil, fmt.Errorf("hash dependency %s", dependency)
		}
		out = append(out, sourceHashRecord{
			File:       relativeFile(root, file),
			SourceHash: hash,
		})
	}
	return out, nil
}

func relativeFile(root string, file string) string {
	if relative, err := filepath.Rel(root, file); err == nil && !filepath.IsAbs(relative) {
		return filepath.ToSlash(relative)
	}
	return filepath.ToSlash(file)
}
