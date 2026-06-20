package devtools

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func projectSemanticIndexRequest(root, configPath, projectName string, index store.IndexData, files []string, sourceProfile *SemanticSourceProfile) ProjectSemanticIndexRequest {
	selectedFiles := semanticFilesFromScope(index, files)
	previous := compactSemanticPreviousIndex(index)
	dependencyClosure := semanticDependencyClosureFromIndex(index, selectedFiles)
	return ProjectSemanticIndexRequest{
		Root:              root,
		ConfigPath:        configPath,
		ProjectName:       projectName,
		Budget:            projectIndexSemanticBudget,
		PreviousIndex:     &previous,
		Files:             selectedFiles,
		DependencyClosure: dependencyClosure,
		SourceProfile:     semanticSourceProfileWithClosure(sourceProfile, dependencyClosure),
	}
}

func semanticSourceProfileWithClosure(profile *SemanticSourceProfile, dependencyClosure []string) *SemanticSourceProfile {
	if profile == nil {
		return nil
	}
	next := *profile
	next.Files = append([]SemanticSourceProfileFile(nil), profile.Files...)
	next.DependencyClosure = sortedUniqueStrings(append(append([]string(nil), profile.DependencyClosure...), dependencyClosure...))
	profileFiles := map[string]bool{}
	sourceBytes := 0
	for _, file := range next.Files {
		if file.File != "" {
			profileFiles[file.File] = true
		}
		sourceBytes += file.SourceBytes
	}
	next.SourceBytes = sourceBytes
	next.Complete = len(next.DependencyClosure) > 0
	for _, file := range next.DependencyClosure {
		if !profileFiles[file] {
			next.Complete = false
			break
		}
	}
	return &next
}

func compactSemanticPreviousIndex(index store.IndexData) store.IndexData {
	return store.IndexData{
		SchemaVersion: index.SchemaVersion,
		Project:       index.Project,
		IndexedAt:     index.IndexedAt,
		Indexing:      index.Indexing,
		Lint:          index.Lint,
		Definitions:   append([]store.ProjectDefinition(nil), index.Definitions...),
		Sources:       append([]store.IndexSourceFile(nil), index.Sources...),
		SourceGraph:   index.SourceGraph,
	}
}

func semanticFilesFromScope(index store.IndexData, files []string) []string {
	if len(files) > 0 {
		return sortedUniqueStrings(files)
	}
	sourceFiles := make([]string, 0, len(index.Sources))
	for _, source := range index.Sources {
		if source.File == "" || source.Status == "deleted" {
			continue
		}
		sourceFiles = append(sourceFiles, source.File)
	}
	return sortedUniqueStrings(sourceFiles)
}

func semanticDependencyClosureFromIndex(index store.IndexData, files []string) []string {
	if index.SourceGraph == nil || !stringSliceContains(index.SourceGraph.Capabilities, "source-dependencies") {
		return nil
	}
	dependenciesByFile := map[string][]string{}
	sourceFiles := map[string]bool{}
	for _, source := range index.Sources {
		if source.File == "" || source.Status == "deleted" {
			continue
		}
		sourceFiles[source.File] = true
		dependenciesByFile[source.File] = append([]string(nil), source.Dependencies...)
	}
	seen := map[string]bool{}
	queue := append([]string(nil), files...)
	for len(queue) > 0 {
		file := queue[0]
		queue = queue[1:]
		if file == "" || seen[file] {
			continue
		}
		seen[file] = true
		for _, dependency := range dependenciesByFile[file] {
			if dependency == "" || seen[dependency] || !sourceFiles[dependency] {
				continue
			}
			queue = append(queue, dependency)
		}
	}
	return sortedKeysFromBoolMap(seen)
}

func sortedUniqueStrings(values []string) []string {
	seen := map[string]bool{}
	for _, value := range values {
		if value != "" {
			seen[value] = true
		}
	}
	return sortedKeysFromBoolMap(seen)
}

func sortedKeysFromBoolMap(values map[string]bool) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func isZeroIndexPatchBudget(budget IndexPatchBudget) bool {
	return budget == IndexPatchBudget{}
}
