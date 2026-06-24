package devtools

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func projectSemanticIndexRequest(root, configPath, projectName string, index store.IndexData, files []string, sourceProfile *SemanticSourceProfile) ProjectSemanticIndexRequest {
	selectedFiles := semanticFilesFromScope(index, files, sourceProfile)
	dependencyClosure := semanticDependencyClosureFromIndex(index, selectedFiles)
	dependencyClosure = semanticDependencyClosureFromSourceProfile(sourceProfile, selectedFiles, dependencyClosure)
	previous := compactSemanticPreviousIndex(index, semanticPreviousIndexScopeFiles(selectedFiles, dependencyClosure))
	return ProjectSemanticIndexRequest{
		Root:              root,
		ConfigPath:        configPath,
		ProjectName:       projectName,
		Budget:            projectIndexSemanticBudget,
		PreviousIndex:     &previous,
		Files:             selectedFiles,
		DependencyClosure: dependencyClosure,
		SourceProfile:     semanticSourceProfileWithClosure(sourceProfile, selectedFiles, dependencyClosure),
	}
}

func semanticDependencyClosureFromSourceProfile(
	profile *SemanticSourceProfile,
	files []string,
	fallback []string,
) []string {
	if profile == nil || !profile.Complete || len(profile.DependencyClosure) == 0 {
		return fallback
	}
	closure := sortedUniqueStrings(profile.DependencyClosure)
	closureSet := map[string]bool{}
	for _, file := range closure {
		if file != "" {
			closureSet[file] = true
		}
	}
	for _, file := range files {
		if file != "" && !closureSet[file] {
			return fallback
		}
	}
	return closure
}

func semanticPreviousIndexScopeFiles(files []string, dependencyClosure []string) []string {
	return sortedUniqueStrings(append(append([]string(nil), files...), dependencyClosure...))
}

func semanticSourceProfileWithClosure(profile *SemanticSourceProfile, files []string, dependencyClosure []string) *SemanticSourceProfile {
	if profile == nil {
		return nil
	}
	next := *profile
	next.DependencyClosure = sortedUniqueStrings(append(append(append([]string(nil), profile.DependencyClosure...), files...), dependencyClosure...))
	closureFiles := map[string]bool{}
	for _, file := range next.DependencyClosure {
		if file != "" {
			closureFiles[file] = true
		}
	}
	next.Files = make([]SemanticSourceProfileFile, 0, len(profile.Files))
	profileFiles := map[string]bool{}
	sourceBytes := 0
	for _, file := range profile.Files {
		if len(closureFiles) > 0 && !closureFiles[file.File] {
			continue
		}
		next.Files = append(next.Files, file)
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

func compactSemanticPreviousIndex(index store.IndexData, scopeFiles []string) store.IndexData {
	previous := store.IndexData{
		SchemaVersion: index.SchemaVersion,
		Project:       index.Project,
		IndexedAt:     index.IndexedAt,
		Indexing:      index.Indexing,
		Lint:          index.Lint,
		SourceGraph:   index.SourceGraph,
	}
	if len(scopeFiles) == 0 {
		previous.Definitions = append([]store.ProjectDefinition(nil), index.Definitions...)
		previous.Sources = append([]store.IndexSourceFile(nil), index.Sources...)
		return previous
	}
	scope := map[string]bool{}
	for _, file := range scopeFiles {
		if file != "" {
			scope[file] = true
		}
	}
	previous.Definitions = make([]store.ProjectDefinition, 0, len(index.Definitions))
	for _, definition := range index.Definitions {
		if definition.Source == nil || definition.Source.File == "" || scope[definition.Source.File] {
			previous.Definitions = append(previous.Definitions, definition)
		}
	}
	previous.Sources = make([]store.IndexSourceFile, 0, len(index.Sources))
	for _, source := range index.Sources {
		if source.File == "" || scope[source.File] {
			previous.Sources = append(previous.Sources, source)
		}
	}
	return previous
}

func semanticFilesFromScope(index store.IndexData, files []string, sourceProfile *SemanticSourceProfile) []string {
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
	return semanticRootFilesFromSourceProfile(sortedUniqueStrings(sourceFiles), sourceProfile)
}

func semanticRootFilesFromSourceProfile(files []string, sourceProfile *SemanticSourceProfile) []string {
	if sourceProfile == nil {
		return files
	}
	profilesByFile := map[string]SemanticSourceProfileFile{}
	for _, file := range sourceProfile.Files {
		if file.File != "" {
			profilesByFile[file.File] = file
		}
	}
	selected := make([]string, 0, len(files))
	for _, file := range files {
		profile, ok := profilesByFile[file]
		if !ok || isSemanticRootSourceProfile(profile) {
			selected = append(selected, file)
		}
	}
	return selected
}

func isSemanticRootSourceProfile(profile SemanticSourceProfileFile) bool {
	if profile.Hints == nil {
		return true
	}
	hints := profile.Hints
	hasCurrentShapeHints := hints.CruxCallNames != nil || hints.HasZodObject || hints.NativeDirectCruxCandidate
	if !hasCurrentShapeHints {
		return true
	}
	return len(hints.CruxCallNames) > 0
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
