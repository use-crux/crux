package planner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

const (
	TimingFileWalk          = "native.plan.file_walk"
	TimingFileClassify      = "native.plan.file_classify"
	TimingSupportFiles      = "native.plan.support_files"
	TimingSelectionFinalize = "native.plan.selection_finalize"
)

func fileSelectionWithCallNamesTimed(
	root string,
	configFile string,
	callNames []string,
) (fileSelectionResult, []projectindex.ProjectIndexPhaseTiming, error) {
	discoveryCache := loadDiscoveryCache(root)
	defer discoveryCache.Save()

	classified, skipped, timings, err := primaryCandidateFilesTimedWithCache(root, callNames, discoveryCache)
	if err != nil {
		return fileSelectionResult{}, timings, err
	}
	finalizeStarted := time.Now()
	primary := append([]string(nil), classified...)
	if configFile != "" {
		primary = appendUniqueSorted(primary, configFile)
	}
	files := append([]string(nil), primary...)
	supportStarted := time.Now()
	for _, support := range supportFilesWithCache(primary, discoveryCache) {
		files = appendUniqueSorted(files, support)
	}
	timings = AppendTiming(timings, TimingSupportFiles, supportStarted, len(files)-len(primary))
	timings = AppendTiming(timings, TimingSelectionFinalize, finalizeStarted, len(files))
	return fileSelectionResult{
		Files:        files,
		PrimaryFiles: primary,
		Skipped:      skipped,
	}, timings, nil
}

func primaryCandidateFilesTimed(
	root string,
	callNames []string,
) ([]string, []json.RawMessage, []projectindex.ProjectIndexPhaseTiming, error) {
	return primaryCandidateFilesTimedWithCache(root, callNames, nil)
}

func primaryCandidateFilesTimedWithCache(
	root string,
	callNames []string,
	discoveryCache *discoveryCache,
) ([]string, []json.RawMessage, []projectindex.ProjectIndexPhaseTiming, error) {
	timings := []projectindex.ProjectIndexPhaseTiming{}
	walkStarted := time.Now()
	candidates, err := candidateFiles(root)
	if err != nil {
		return nil, nil, timings, err
	}
	timings = AppendTiming(timings, TimingFileWalk, walkStarted, len(candidates))

	classifyStarted := time.Now()
	classifications := classifyCandidatesWithCache(candidates, callNames, discoveryCache)
	timings = AppendTiming(timings, TimingFileClassify, classifyStarted, len(classifications))

	files := []string{}
	skipped := []json.RawMessage{}
	for _, classification := range classifications {
		if classification.Action == "index" {
			files = append(files, classification.File)
			continue
		}
		raw, marshalErr := json.Marshal(classification)
		if marshalErr != nil {
			return nil, nil, timings, fmt.Errorf("select Static Index files: %w", marshalErr)
		}
		skipped = append(skipped, raw)
	}
	sort.Strings(files)
	return files, skipped, timings, nil
}

func candidateFiles(root string) ([]string, error) {
	candidates := []string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if path != root && ignoredDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if ignoredSourcePath(root, path) {
			return nil
		}
		if !candidateSourceFile(path) {
			return nil
		}
		candidates = append(candidates, path)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("select Static Index files: %w", err)
	}
	return candidates, nil
}
