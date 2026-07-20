package planner

import (
	"context"
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner/sourcegraph"
)

type Result struct {
	Plan    projectindex.ProjectStaticSyntaxPlan
	Timings []projectindex.ProjectIndexPhaseTiming
}

func Build(
	root string,
	projectName string,
	config projectindex.ProjectStaticIndexConfig,
) (projectindex.ProjectStaticSyntaxPlan, error) {
	result, err := BuildWithTimings(root, projectName, config)
	if err != nil {
		return projectindex.ProjectStaticSyntaxPlan{}, err
	}
	return result.Plan, nil
}

func BuildWithTimings(
	root string,
	projectName string,
	config projectindex.ProjectStaticIndexConfig,
) (Result, error) {
	return BuildWithExtensionManifest(root, projectName, config, nil)
}

func BuildWithExtensionManifest(
	root string,
	projectName string,
	config projectindex.ProjectStaticIndexConfig,
	extensionManifest *projectindex.StaticExtensionHostManifestResult,
) (Result, error) {
	return BuildWithExtensionManifestContext(context.Background(), root, projectName, config, extensionManifest)
}

func BuildWithExtensionManifestContext(
	ctx context.Context,
	root string,
	projectName string,
	config projectindex.ProjectStaticIndexConfig,
	extensionManifest *projectindex.StaticExtensionHostManifestResult,
) (Result, error) {
	timings := []projectindex.ProjectIndexPhaseTiming{}
	var cacheInputs []json.RawMessage
	if config.StaticSyntaxEnabled {
		cacheInputs = DefaultCacheCompilerInputs()
	}
	plan := projectindex.ProjectStaticSyntaxPlan{
		Root:                     root,
		ProjectName:              projectName,
		ConfigFile:               config.ConfigFile,
		RuntimeConfigured:        config.RuntimeConfigured,
		CallNames:                append([]string(nil), defaultCallNames...),
		CallInterests:            defaultCallInterests(),
		ConstructorNames:         []string{"Agent"},
		ConstructorInterests:     defaultConstructorInterests(),
		PruneNativeFactCallNames: []string{"cascade", "fallback", "router"},
		SyntaxFrontend:           syntaxFrontend(),
		StaticSyntaxEnabled:      config.StaticSyntaxEnabled,
		StaticInterests:          defaultStaticInterests(),
		RelationSpecs:            nil,
		RuleDescriptors:          nil,
		LintConfig:               append(json.RawMessage(nil), config.Lint...),
		CacheInputs:              cacheInputs,
		StaticHost:               defaultHost(),
	}
	if config.StaticSyntaxEnabled && extensionManifest != nil {
		if err := mergeExtensionHostManifest(&plan, *extensionManifest); err != nil {
			return Result{}, err
		}
	}

	fileSelectionStarted := time.Now()
	var fileSelectionCallNames []string
	if extensionManifest != nil {
		fileSelectionCallNames = plan.CallNames
	}
	selection, selectionTimings, err := fileSelectionWithCallNamesTimed(
		ctx,
		root,
		config.ConfigFile,
		fileSelectionCallNames,
	)
	if err != nil {
		return Result{}, err
	}
	timings = AppendTiming(timings, TimingFileSelection, fileSelectionStarted, len(selection.Files))
	timings = append(timings, selectionTimings...)
	plan.Files = selection.Files
	plan.PrimaryFiles = selection.PrimaryFiles
	plan.Skipped = selection.Skipped

	sourceGraphStarted := time.Now()
	sourceGraph, err := sourcegraph.Marshal(root)
	if err != nil {
		return Result{}, err
	}
	timings = AppendTiming(timings, TimingSourceGraph, sourceGraphStarted, 1)
	plan.SourceGraph = sourceGraph

	if config.StaticSyntaxEnabled && cache.StatusEnabledFromEnv() && !projectindex.CacheDisabled(ctx) {
		cacheStarted := time.Now()
		applyCacheManifestStatus(&plan)
		timings = AppendTiming(timings, TimingCacheStatus, cacheStarted, len(plan.PrimaryFiles))
	}
	return Result{Plan: plan, Timings: timings}, nil
}

func applyCacheManifestStatus(plan *projectindex.ProjectStaticSyntaxPlan) {
	if plan == nil || len(plan.CacheInputs) == 0 {
		return
	}
	primaryFiles := plan.PrimaryFiles
	if len(primaryFiles) == 0 {
		primaryFiles = plan.Files
	}
	cacheStatus := cache.ManifestStatus(plan.Root, primaryFiles, plan.CacheInputs)
	plan.CacheHits = cacheStatus.CacheHits
	plan.CacheMisses = cacheStatus.CacheMisses
	plan.CacheEntries = cacheStatus.CacheEntries
	plan.FilesToParse = cache.FilesToParse(cacheStatus.CacheMisses, plan.Files, primaryFiles)
}

func RefreshFileSelection(
	plan *projectindex.ProjectStaticSyntaxPlan,
	root string,
	configFile string,
) error {
	selection, err := fileSelectionWithCallNames(root, configFile, plan.CallNames)
	if err != nil {
		return err
	}
	plan.Files = selection.Files
	plan.PrimaryFiles = selection.PrimaryFiles
	plan.Skipped = selection.Skipped
	return nil
}
