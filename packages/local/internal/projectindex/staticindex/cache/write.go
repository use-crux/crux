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
	File                 string                                                 `json:"file"`
	InterfaceHash        string                                                 `json:"interfaceHash,omitempty"`
	Definitions          []store.ProjectDefinition                              `json:"definitions"`
	DefinitionExtractors map[string][]projectindex.IndexFactExtractorProvenance `json:"definitionExtractors,omitempty"`
	FactExtractors       map[string][]projectindex.IndexFactExtractorProvenance `json:"factExtractors,omitempty"`
	Relations            []store.ProjectRelation                                `json:"relations"`
	SourceRefs           []projectindex.IndexSourceRefFact                      `json:"sourceRefs"`
	Diagnostics          []store.IndexDiagnostic                                `json:"diagnostics"`
	Dependencies         []string                                               `json:"dependencies"`
	SemanticProfile      *projectindex.SemanticSourceProfileFile                `json:"semanticProfile,omitempty"`
}

func WriteFromPatch(
	root string,
	cacheInputs []json.RawMessage,
	configDependencies []string,
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
	configFiles := readConfigFileHashes(root, configDependencies)

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
			Root:                 root,
			File:                 file,
			SourceHash:           sourceFile.SourceHash,
			Source:               source,
			ConfigFiles:          configFiles,
			CompilerInputs:       cacheInputs,
			SemanticProfile:      sourceProfiles[file],
			Patch:                patch.Facts,
			DefinitionExtractors: definitionExtractorsFromEnvelopes(patch.FactEnvelopes),
			FactExtractors:       factExtractorsFromEnvelopes(patch.FactEnvelopes),
		}
		_ = writeFile(write)
	}
}

type writeForFile struct {
	Root                 string
	File                 string
	SourceHash           string
	Source               store.IndexSourceFile
	ConfigFiles          []sourceHashRecord
	CompilerInputs       []json.RawMessage
	SemanticProfile      *projectindex.SemanticSourceProfileFile
	Patch                projectindex.IndexPatchFacts
	DefinitionExtractors map[string][]projectindex.IndexFactExtractorProvenance
	FactExtractors       map[string][]projectindex.IndexFactExtractorProvenance
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
	relations := relationsForCache(input.File, ids, input.Patch.Relations)
	sourceRefs := sourceRefsForCache(ids, input.Patch.SourceRefs)
	diagnostics := diagnosticsForCache(input.File, ids, input.Source.Diagnostics, input.Patch.Diagnostics)
	return WritableExtraction{
		File:                 input.File,
		InterfaceHash:        input.Source.InterfaceHash,
		Definitions:          definitions,
		DefinitionExtractors: definitionExtractorsForCache(ids, input.DefinitionExtractors),
		FactExtractors:       factExtractorsForCachedFacts(definitions, relations, sourceRefs, diagnostics, input.FactExtractors),
		Relations:            relations,
		SourceRefs:           sourceRefs,
		Diagnostics:          diagnostics,
		Dependencies:         uniqueStrings(input.Source.Dependencies),
		SemanticProfile:      input.SemanticProfile,
	}
}

func factExtractorsFromEnvelopes(
	envelopes []projectindex.IndexFactEnvelope,
) map[string][]projectindex.IndexFactExtractorProvenance {
	result := map[string][]projectindex.IndexFactExtractorProvenance{}
	for _, envelope := range envelopes {
		if len(envelope.Provenance.Extractors) == 0 {
			continue
		}
		key := envelope.FactID
		if envelope.Kind == "sourceRefs" {
			var sourceRef projectindex.IndexSourceRefFact
			if json.Unmarshal(envelope.Fact, &sourceRef) != nil || sourceRef.DefinitionID == "" || sourceRef.Ref.ID == "" {
				continue
			}
			key = "sourceRefs:" + sourceRef.DefinitionID + ":" + sourceRef.Ref.ID
		}
		result[key] = append([]projectindex.IndexFactExtractorProvenance(nil), envelope.Provenance.Extractors...)
	}
	return result
}

func sourceRefsForCache(ids map[string]bool, refs []projectindex.IndexSourceRefFact) []projectindex.IndexSourceRefFact {
	result := make([]projectindex.IndexSourceRefFact, 0, len(refs))
	for _, ref := range refs {
		if ids[ref.DefinitionID] {
			result = append(result, ref)
		}
	}
	return result
}

func factExtractorsForCachedFacts(
	definitions []store.ProjectDefinition,
	relations []store.ProjectRelation,
	sourceRefs []projectindex.IndexSourceRefFact,
	diagnostics []store.IndexDiagnostic,
	extractors map[string][]projectindex.IndexFactExtractorProvenance,
) map[string][]projectindex.IndexFactExtractorProvenance {
	keys := map[string]bool{}
	for _, definition := range definitions {
		keys["definitions:"+definition.ID] = true
	}
	for _, relation := range relations {
		keys["relations:"+relation.ID] = true
	}
	for _, ref := range sourceRefs {
		keys["sourceRefs:"+ref.DefinitionID+":"+ref.Ref.ID] = true
	}
	for _, diagnostic := range diagnostics {
		keys["diagnostics:"+diagnostic.ID] = true
	}
	result := map[string][]projectindex.IndexFactExtractorProvenance{}
	for key := range keys {
		if contributors := extractors[key]; len(contributors) > 0 {
			result[key] = append([]projectindex.IndexFactExtractorProvenance(nil), contributors...)
		}
	}
	return result
}

func definitionExtractorsFromEnvelopes(
	envelopes []projectindex.IndexFactEnvelope,
) map[string][]projectindex.IndexFactExtractorProvenance {
	result := map[string][]projectindex.IndexFactExtractorProvenance{}
	for _, envelope := range envelopes {
		if envelope.Kind != "definitions" || len(envelope.Provenance.Extractors) == 0 {
			continue
		}
		var definition struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(envelope.Fact, &definition) != nil || definition.ID == "" {
			continue
		}
		result[definition.ID] = append(
			[]projectindex.IndexFactExtractorProvenance(nil),
			envelope.Provenance.Extractors...,
		)
	}
	return result
}

func definitionExtractorsForCache(
	ids map[string]bool,
	extractors map[string][]projectindex.IndexFactExtractorProvenance,
) map[string][]projectindex.IndexFactExtractorProvenance {
	result := map[string][]projectindex.IndexFactExtractorProvenance{}
	for id := range ids {
		if contributors := extractors[id]; len(contributors) > 0 {
			result[id] = append([]projectindex.IndexFactExtractorProvenance(nil), contributors...)
		}
	}
	return result
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
