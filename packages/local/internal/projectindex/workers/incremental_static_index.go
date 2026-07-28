package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/session"
	"github.com/use-crux/crux/packages/local/internal/store"
)

const incrementalGraphConfidence = "complete-enough-for-source-closure"

func (w *Bundle) canUseStaticIndexIncremental(previous store.IndexData, mode string) bool {
	if w == nil || w.syntaxParser == nil || mode != "ast" {
		return false
	}
	if _, ok := w.syntaxParser.(StaticCompiler); !ok {
		return false
	}
	return projectindex.HasCompleteShardEvidence(previous)
}

func (w *Bundle) indexProjectIncrementalFromStaticIndex(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	previous store.IndexData,
	files []string,
	deletedFiles []string,
) (projectindex.ProjectIndexIncrementalResult, error) {
	started := time.Now()
	if len(deletedFiles) > 0 {
		return projectindex.ProjectIndexIncrementalResult{}, fmt.Errorf("Static Index incremental deleted-file refresh requires full reindex")
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		return projectindex.ProjectIndexIncrementalResult{}, fmt.Errorf("project Static Index compiler is not configured")
	}

	planningStarted := time.Now()
	affectedFiles, ok := incrementalAffectedFiles(root, previous, files)
	if !ok || len(affectedFiles) == 0 {
		return projectindex.ProjectIndexIncrementalResult{}, fmt.Errorf("Static Index incremental source closure is unavailable")
	}
	closureFiles := incrementalDependencyClosure(root, previous, affectedFiles)
	sourceGraph, err := json.Marshal(previous.SourceGraph)
	if err != nil {
		return projectindex.ProjectIndexIncrementalResult{}, fmt.Errorf("marshal previous source graph: %w", err)
	}
	lintConfig, err := json.Marshal(previous.Lint)
	if err != nil {
		return projectindex.ProjectIndexIncrementalResult{}, fmt.Errorf("marshal previous lint config: %w", err)
	}
	plan := planner.BuildIncremental(planner.IncrementalPlanInput{
		Root:                     root,
		ProjectName:              projectName,
		ConfigFile:               incrementalConfigFile(configPath, previous),
		RuntimeConfigured:        incrementalRuntimeConfigured(previous),
		RedactPatternsConfigured: incrementalRedactPatternsConfigured(previous),
		Files:                    closureFiles,
		PrimaryFiles:             affectedFiles,
		SourceGraph:              sourceGraph,
		LintConfig:               lintConfig,
	})
	invalidates, err := json.Marshal(projectindex.IndexPatchInvalidation{Files: affectedFiles})
	if err != nil {
		return projectindex.ProjectIndexIncrementalResult{}, fmt.Errorf("marshal incremental invalidation: %w", err)
	}
	planningMs := elapsedMs(planningStarted)

	astStarted := time.Now()
	result, err := w.staticIndexSessionForPlanWithInvalidates(
		root,
		configPath,
		projectName,
		plan,
		compiler,
		invalidates,
	).Run(ctx)
	timing := projectIndexAstTimingFromStaticIndexSession(result)
	timing.PlanMs = planningMs
	timing.TotalMs = elapsedMs(started)
	if result.UsedStaticIndex {
		timing.UsedStaticIndex = true
	}
	w.recordLastAstTiming(timing)
	if err != nil {
		return projectindex.ProjectIndexIncrementalResult{}, err
	}
	if result.Status != session.StatusComplete || !result.UsedStaticIndex {
		return projectindex.ProjectIndexIncrementalResult{}, fmt.Errorf("Static Index incremental did not produce a complete patch (status: %s)", result.Status)
	}

	patch := result.Patch
	patch.Invalidates = &projectindex.IndexPatchInvalidation{Files: append([]string(nil), affectedFiles...)}
	return projectindex.ProjectIndexIncrementalResult{
		Decision: incrementalDecision(root, files, deletedFiles, affectedFiles),
		Patches:  []projectindex.IndexPatch{patch},
		Report: projectindex.ProjectIndexIncrementalReport{
			PlanKind:                 "source-file-reindex",
			ASTUsedStaticIndex:       true,
			GraphConfidence:          incrementalGraphConfidence,
			ChangedFiles:             append([]string(nil), files...),
			DeletedFiles:             append([]string(nil), deletedFiles...),
			AffectedFiles:            append([]string(nil), affectedFiles...),
			AffectedDefinitionIDs:    incrementalAffectedDefinitionIDs(previous, affectedFiles),
			StaticParsedFiles:        append([]string(nil), plan.FilesToParse...),
			StaticCacheMisses:        len(plan.CacheMisses),
			InvalidatedFiles:         append([]string(nil), affectedFiles...),
			InvalidatedDefinitionIDs: incrementalAffectedDefinitionIDs(previous, affectedFiles),
			DurationMsByPhase: map[string]float64{
				"planning": planningMs,
				"ast":      elapsedMs(astStarted),
			},
			PatchCounts:            projectindex.ProjectIndexPatchCounts{AST: 1, Total: 1},
			SourceProfileFileCount: semanticSourceProfileFileCount(patch.SemanticSourceProfile),
			SemanticStatus:         "not-requested",
		},
	}, nil
}

func incrementalAffectedFiles(root string, index store.IndexData, files []string) ([]string, bool) {
	sourceByCanonical := map[string]string{}
	dependentsByCanonical := map[string][]string{}
	for _, source := range index.Sources {
		if source.File == "" || source.Status == "deleted" {
			continue
		}
		canonical := incrementalCanonicalFile(root, source.File)
		sourceByCanonical[canonical] = source.File
		dependentsByCanonical[canonical] = append([]string(nil), source.Dependents...)
	}
	seen := map[string]bool{}
	queue := []string{}
	for _, file := range files {
		actual, ok := sourceByCanonical[incrementalCanonicalFile(root, file)]
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
		for _, dependent := range dependentsByCanonical[incrementalCanonicalFile(root, file)] {
			actual, ok := sourceByCanonical[incrementalCanonicalFile(root, dependent)]
			if ok && !seen[actual] {
				queue = append(queue, actual)
			}
		}
	}
	return sortedStringSet(seen), true
}

func incrementalDependencyClosure(root string, index store.IndexData, affectedFiles []string) []string {
	sourceByCanonical := map[string]store.IndexSourceFile{}
	for _, source := range index.Sources {
		if source.File == "" || source.Status == "deleted" {
			continue
		}
		sourceByCanonical[incrementalCanonicalFile(root, source.File)] = source
	}
	seen := map[string]bool{}
	queue := append([]string(nil), affectedFiles...)
	for len(queue) > 0 {
		sort.Strings(queue)
		file := queue[0]
		queue = queue[1:]
		source, ok := sourceByCanonical[incrementalCanonicalFile(root, file)]
		if !ok || seen[source.File] {
			continue
		}
		seen[source.File] = true
		for _, dependency := range source.Dependencies {
			if actual, ok := sourceByCanonical[incrementalCanonicalFile(root, dependency)]; ok && !seen[actual.File] {
				queue = append(queue, actual.File)
			}
		}
	}
	return sortedStringSet(seen)
}

func incrementalAffectedDefinitionIDs(index store.IndexData, files []string) []string {
	fileSet := stringBoolSet(files)
	seen := map[string]bool{}
	for _, source := range index.Sources {
		if !fileSet[source.File] {
			continue
		}
		for _, id := range source.DefinitionIDs {
			seen[id] = true
		}
	}
	for _, definition := range index.Definitions {
		if definition.Source != nil && fileSet[definition.Source.File] {
			seen[definition.ID] = true
		}
	}
	return sortedStringSet(seen)
}

func incrementalDecision(root string, files []string, deletedFiles []string, affectedFiles []string) map[string]any {
	return map[string]any{
		"kind":          "source-file-reindex",
		"root":          root,
		"files":         append([]string(nil), files...),
		"deletedFiles":  append([]string(nil), deletedFiles...),
		"affectedFiles": append([]string(nil), affectedFiles...),
	}
}

func incrementalConfigFile(configPath string, previous store.IndexData) string {
	if configPath != "" {
		return configPath
	}
	if previous.Project != nil {
		return previous.Project.ConfigFile
	}
	return ""
}

func incrementalRuntimeConfigured(previous store.IndexData) *bool {
	if previous.Project == nil {
		return nil
	}
	return previous.Project.RuntimeConfigured
}

func incrementalRedactPatternsConfigured(previous store.IndexData) *bool {
	if previous.Project == nil || previous.Project.Observability == nil {
		return nil
	}
	configured := previous.Project.Observability.RedactPatternsConfigured
	return &configured
}

func incrementalCanonicalFile(root string, file string) string {
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

func semanticSourceProfileFileCount(profile *projectindex.SemanticSourceProfile) int {
	if profile == nil {
		return 0
	}
	return len(profile.Files)
}

func stringBoolSet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		if value != "" {
			out[value] = true
		}
	}
	return out
}

func sortedStringSet(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		if value != "" {
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}
