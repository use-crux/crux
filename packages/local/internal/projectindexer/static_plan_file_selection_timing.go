package projectindexer

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

const (
	projectNativeStaticPlanTimingFileWalk          = "native.plan.file_walk"
	projectNativeStaticPlanTimingFileClassify      = "native.plan.file_classify"
	projectNativeStaticPlanTimingSupportFiles      = "native.plan.support_files"
	projectNativeStaticPlanTimingSelectionFinalize = "native.plan.selection_finalize"
)

func projectNativeStaticFileSelectionWithCallNamesTimed(
	root string,
	configFile string,
	callNames []string,
) (projectNativeStaticFileSelectionResult, []devtools.ProjectIndexPhaseTiming, error) {
	discoveryCache := projectNativeStaticLoadDiscoveryCache(root)
	defer discoveryCache.Save()

	classified, skipped, timings, err := projectNativeStaticPrimaryCandidateFilesTimedWithCache(root, callNames, discoveryCache)
	if err != nil {
		return projectNativeStaticFileSelectionResult{}, timings, err
	}
	finalizeStarted := time.Now()
	primary := append([]string(nil), classified...)
	if configFile != "" {
		primary = appendUniqueSorted(primary, configFile)
	}
	files := append([]string(nil), primary...)
	supportStarted := time.Now()
	for _, support := range projectNativeStaticSupportFilesWithCache(primary, discoveryCache) {
		files = appendUniqueSorted(files, support)
	}
	timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingSupportFiles, supportStarted, len(files)-len(primary))
	timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingSelectionFinalize, finalizeStarted, len(files))
	return projectNativeStaticFileSelectionResult{
		Files:        files,
		PrimaryFiles: primary,
		Skipped:      skipped,
	}, timings, nil
}

func projectNativeStaticPrimaryCandidateFilesTimed(
	root string,
	callNames []string,
) ([]string, []json.RawMessage, []devtools.ProjectIndexPhaseTiming, error) {
	return projectNativeStaticPrimaryCandidateFilesTimedWithCache(root, callNames, nil)
}

func projectNativeStaticPrimaryCandidateFilesTimedWithCache(
	root string,
	callNames []string,
	discoveryCache *projectNativeStaticDiscoveryCache,
) ([]string, []json.RawMessage, []devtools.ProjectIndexPhaseTiming, error) {
	timings := []devtools.ProjectIndexPhaseTiming{}
	walkStarted := time.Now()
	candidates, err := projectNativeStaticCandidateFiles(root)
	if err != nil {
		return nil, nil, timings, err
	}
	timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingFileWalk, walkStarted, len(candidates))

	classifyStarted := time.Now()
	classifications := projectNativeStaticClassifyCandidatesWithCache(candidates, callNames, discoveryCache)
	timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingFileClassify, classifyStarted, len(classifications))

	files := []string{}
	skipped := []json.RawMessage{}
	for _, classification := range classifications {
		if classification.Action == "index" {
			files = append(files, classification.File)
			continue
		}
		raw, marshalErr := json.Marshal(classification)
		if marshalErr != nil {
			return nil, nil, timings, fmt.Errorf("select native static files: %w", marshalErr)
		}
		skipped = append(skipped, raw)
	}
	sort.Strings(files)
	return files, skipped, timings, nil
}

func projectNativeStaticCandidateFiles(root string) ([]string, error) {
	candidates := []string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != root && projectNativeStaticIgnoredDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if projectNativeStaticIgnoredSourcePath(root, path) {
			return nil
		}
		if !projectNativeStaticCandidateSourceFile(path) {
			return nil
		}
		candidates = append(candidates, path)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("select native static files: %w", err)
	}
	return candidates, nil
}
