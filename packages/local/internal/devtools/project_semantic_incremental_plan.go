package devtools

import (
	"context"
	"path/filepath"
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

func (s *Service) applyPlannedProjectIncrementalSemanticPatch(
	ctx context.Context,
	request ProjectSemanticIndexRequest,
	task *projectSemanticPatchTask,
	lintPrefetch *projectLintPrefetchTask,
	astIndex store.IndexData,
) (store.IndexData, error) {
	if task == nil {
		return s.applyProjectSemanticPatch(ctx, request, lintPrefetch)
	}
	result := task.wait()
	if result.stage != "semantic" || !projectSemanticRequestScopeMatches(result.request, request) {
		return s.applyProjectSemanticPatch(ctx, request, lintPrefetch)
	}
	patch := projectSemanticPatchWithAstSnapshot(result.patch, astIndex)
	return s.applyProjectSemanticPatchResult(ctx, request, result.startedAt, patch, result.err, lintPrefetch)
}

func (s *Service) applyPlannedProjectIncrementalSemanticPatchInBackground(
	request ProjectSemanticIndexRequest,
	task *projectSemanticPatchTask,
	astIndex store.IndexData,
) {
	go func() {
		_, _ = s.applyPlannedProjectIncrementalSemanticPatch(s.ctx, request, task, nil, astIndex)
	}()
}

func projectIncrementalSemanticRequestFromPreviousGraph(
	root string,
	configPath string,
	projectName string,
	previous store.IndexData,
	files []string,
	deletedFiles []string,
) (ProjectSemanticIndexRequest, bool) {
	if len(files) == 0 || len(deletedFiles) > 0 || previous.SourceGraph == nil {
		return ProjectSemanticIndexRequest{}, false
	}
	if !stringSliceContains(previous.SourceGraph.Capabilities, "source-dependencies") ||
		!stringSliceContains(previous.SourceGraph.Capabilities, "source-dependents") {
		return ProjectSemanticIndexRequest{}, false
	}
	affectedFiles, ok := projectIncrementalAffectedFilesFromPreviousGraph(root, previous, files)
	if !ok || len(affectedFiles) == 0 {
		return ProjectSemanticIndexRequest{}, false
	}
	dependencyClosure := semanticDependencyClosureFromIndex(previous, affectedFiles)
	return ProjectSemanticIndexRequest{
		Root:              root,
		ConfigPath:        configPath,
		ProjectName:       projectName,
		Budget:            projectIndexSemanticBudget,
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

func projectSemanticRequestScopeMatches(planned ProjectSemanticIndexRequest, final ProjectSemanticIndexRequest) bool {
	return stringSlicesEqual(sortedUniqueStrings(planned.Files), sortedUniqueStrings(final.Files)) &&
		stringSlicesEqual(sortedUniqueStrings(planned.DependencyClosure), sortedUniqueStrings(final.DependencyClosure))
}

func projectSemanticRequestEvidenceMatches(planned ProjectSemanticIndexRequest, final ProjectSemanticIndexRequest) bool {
	return projectSemanticRequestScopeMatches(planned, final) &&
		semanticSourceProfilesMatch(planned.SourceProfile, final.SourceProfile)
}

func semanticSourceProfilesMatch(planned *SemanticSourceProfile, final *SemanticSourceProfile) bool {
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
	finalFiles := map[string]SemanticSourceProfileFile{}
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
