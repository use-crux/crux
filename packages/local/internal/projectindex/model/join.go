package model

import (
	"slices"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func JoinSemanticPatch(patch IndexPatch, index store.IndexData) IndexPatch {
	if patch.Facts.SourceGraph == nil && index.SourceGraph != nil {
		patch.Facts.SourceGraph = index.SourceGraph
	}
	supportSources := projectSemanticSupportSources(index, patch.Facts.SourceRefs)
	if len(supportSources) > 0 {
		patch.Facts.Sources = mergeSourceFiles(patch.Facts.Sources, supportSources)
	}
	return patch
}

func mergeSourceFiles(current []store.IndexSourceFile, incoming []store.IndexSourceFile) []store.IndexSourceFile {
	merged := make([]store.IndexSourceFile, 0, len(current)+len(incoming))
	index := map[string]int{}
	for _, item := range current {
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	for _, item := range incoming {
		if existing, ok := index[item.File]; ok {
			merged[existing] = item
			continue
		}
		index[item.File] = len(merged)
		merged = append(merged, item)
	}
	return merged
}

func projectSemanticSupportSources(
	index store.IndexData,
	sourceRefs []IndexSourceRefFact,
) []store.IndexSourceFile {
	if len(sourceRefs) == 0 {
		return nil
	}
	sources := map[string]*store.IndexSourceFile{}
	ensureSource := func(file string) *store.IndexSourceFile {
		if file == "" {
			return nil
		}
		if existing := sources[file]; existing != nil {
			return existing
		}
		source := &store.IndexSourceFile{File: file, Status: "indexed"}
		sources[file] = source
		return source
	}
	for _, fact := range sourceRefs {
		ownerFile := projectSemanticOwnerFileForDefinition(index, fact.DefinitionID)
		refFile := fact.Ref.Source.File
		if ownerFile == "" || refFile == "" {
			continue
		}
		owner := ensureSource(ownerFile)
		ref := ensureSource(refFile)
		if owner == nil || ref == nil {
			continue
		}
		owner.Dependencies = appendSemanticUniqueSorted(owner.Dependencies, refFile)
		ref.Dependents = appendSemanticUniqueSorted(ref.Dependents, ownerFile)
	}
	files := make([]string, 0, len(sources))
	for file := range sources {
		files = append(files, file)
	}
	sort.Strings(files)
	out := make([]store.IndexSourceFile, 0, len(files))
	for _, file := range files {
		out = append(out, *sources[file])
	}
	return out
}

func appendSemanticUniqueSorted(values []string, next string) []string {
	if next == "" {
		return values
	}
	index := sort.SearchStrings(values, next)
	if index < len(values) && values[index] == next {
		return values
	}
	values = append(values, "")
	copy(values[index+1:], values[index:])
	values[index] = next
	return values
}

func projectSemanticOwnerFileForDefinition(index store.IndexData, definitionID string) string {
	for _, definition := range index.Definitions {
		if definition.ID == definitionID && definition.Source != nil && definition.Source.File != "" {
			return definition.Source.File
		}
	}
	for _, source := range index.Sources {
		if slices.Contains(source.DefinitionIDs, definitionID) {
			return source.File
		}
	}
	return ""
}
