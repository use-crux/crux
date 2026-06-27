package service

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"path/filepath"
	"slices"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) startPlannedProjectIncrementalSemanticPatch(
	ctx context.Context,
	mode ProjectSemanticExecutionMode,
	root string,
	configPath string,
	projectName string,
	previous store.IndexData,
	files []string,
	deletedFiles []string,
) *projectSemanticPatchTask {
	request, ok := projectIncrementalSemanticRequestFromPreviousGraph(root, configPath, projectName, previous, files, deletedFiles)
	if !ok {
		return nil
	}
	return s.startProjectSemanticPatchTask(ctx, mode, request)
}

func projectIncrementalSemanticRequestFromPreviousGraph(
	root string,
	configPath string,
	projectName string,
	previous store.IndexData,
	files []string,
	deletedFiles []string,
) (projectindex.ProjectSemanticIndexRequest, bool) {
	if len(files) == 0 || len(deletedFiles) > 0 || previous.SourceGraph == nil {
		return projectindex.ProjectSemanticIndexRequest{}, false
	}
	if !slices.Contains(previous.SourceGraph.Capabilities, "source-dependencies") ||
		!slices.Contains(previous.SourceGraph.Capabilities, "source-dependents") {
		return projectindex.ProjectSemanticIndexRequest{}, false
	}
	affectedFiles, ok := projectIncrementalAffectedFilesFromPreviousGraph(root, previous, files)
	if !ok || len(affectedFiles) == 0 {
		return projectindex.ProjectSemanticIndexRequest{}, false
	}
	dependencyClosure := semanticDependencyClosureFromIndex(previous, affectedFiles)
	return projectindex.ProjectSemanticIndexRequest{
		Root:              root,
		ConfigPath:        configPath,
		ProjectName:       projectName,
		Budget:            ProjectIndexSemanticBudget,
		Files:             affectedFiles,
		DependencyClosure: dependencyClosure,
	}, true
}

func projectIncrementalAffectedFilesFromPreviousGraph(root string, index store.IndexData, files []string) ([]string, bool) {
	sourceByCanonical := map[string]string{}
	dependentsByCanonical := map[string][]string{}
	for _, source := range index.Sources {
		if source.File == "" || source.Status == "deleted" {
			continue
		}
		canonical := projectIncrementalCanonicalFile(root, source.File)
		sourceByCanonical[canonical] = source.File
		dependentsByCanonical[canonical] = append([]string(nil), source.Dependents...)
	}
	seen := map[string]bool{}
	queue := []string{}
	for _, file := range files {
		actual, ok := sourceByCanonical[projectIncrementalCanonicalFile(root, file)]
		if !ok {
			return nil, false
		}
		queue = append(queue, actual)
	}
	for len(queue) > 0 {
		sort.Strings(queue)
		file := queue[0]
		queue = queue[1:]
		if file == "" || seen[file] {
			continue
		}
		seen[file] = true
		for _, dependent := range dependentsByCanonical[projectIncrementalCanonicalFile(root, file)] {
			actual, ok := sourceByCanonical[projectIncrementalCanonicalFile(root, dependent)]
			if ok && !seen[actual] {
				queue = append(queue, actual)
			}
		}
	}
	return sortedKeysFromBoolMap(seen), true
}

func projectIncrementalCanonicalFile(root string, file string) string {
	if file == "" {
		return ""
	}
	if filepath.IsAbs(file) {
		return filepath.Clean(file)
	}
	absolute, err := filepath.Abs(filepath.Join(root, file))
	if err != nil {
		return filepath.Clean(filepath.Join(root, file))
	}
	return absolute
}

func projectSemanticRequestScopeMatches(planned projectindex.ProjectSemanticIndexRequest, final projectindex.ProjectSemanticIndexRequest) bool {
	return stringSlicesEqual(sortedUniqueStrings(planned.Files), sortedUniqueStrings(final.Files)) &&
		stringSlicesEqual(sortedUniqueStrings(planned.DependencyClosure), sortedUniqueStrings(final.DependencyClosure))
}

func projectSemanticRequestEvidenceMatches(planned projectindex.ProjectSemanticIndexRequest, final projectindex.ProjectSemanticIndexRequest) bool {
	return projectSemanticRequestScopeMatches(planned, final) &&
		semanticSourceProfilesMatch(planned.SourceProfile, final.SourceProfile)
}

func semanticSourceProfilesMatch(planned *projectindex.SemanticSourceProfile, final *projectindex.SemanticSourceProfile) bool {
	if planned == nil || final == nil {
		return planned == nil && final == nil
	}
	if planned.Complete != final.Complete ||
		planned.SourceBytes != final.SourceBytes ||
		!stringSlicesEqual(sortedUniqueStrings(planned.DependencyClosure), sortedUniqueStrings(final.DependencyClosure)) {
		return false
	}
	if len(planned.Files) != len(final.Files) {
		return false
	}
	finalFiles := map[string]projectindex.SemanticSourceProfileFile{}
	for _, file := range final.Files {
		finalFiles[file.File] = file
	}
	for _, plannedFile := range planned.Files {
		finalFile, ok := finalFiles[plannedFile.File]
		if !ok ||
			plannedFile.SourceHash != finalFile.SourceHash ||
			plannedFile.SourceBytes != finalFile.SourceBytes {
			return false
		}
	}
	return true
}

func stringSlicesEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
