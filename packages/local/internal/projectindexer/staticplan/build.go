package staticplan

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticcache"
)

type Result struct {
	Plan    devtools.ProjectStaticSyntaxPlan
	Timings []devtools.ProjectIndexPhaseTiming
}

func Build(
	root string,
	projectName string,
	config devtools.ProjectNativeStaticConfig,
) (devtools.ProjectStaticSyntaxPlan, error) {
	result, err := BuildWithTimings(root, projectName, config)
	if err != nil {
		return devtools.ProjectStaticSyntaxPlan{}, err
	}
	return result.Plan, nil
}

func BuildWithTimings(
	root string,
	projectName string,
	config devtools.ProjectNativeStaticConfig,
) (Result, error) {
	return BuildWithExtensionManifest(root, projectName, config, nil)
}

func BuildWithExtensionManifest(
	root string,
	projectName string,
	config devtools.ProjectNativeStaticConfig,
	extensionManifest *devtools.StaticExtensionHostManifestResult,
) (Result, error) {
	timings := []devtools.ProjectIndexPhaseTiming{}
	var cacheInputs []json.RawMessage
	if config.NativeAstEnabled {
		cacheInputs = DefaultCacheCompilerInputs()
	}
	plan := devtools.ProjectStaticSyntaxPlan{
		Root:                     root,
		ProjectName:              projectName,
		ConfigFile:               config.ConfigFile,
		CallNames:                append([]string(nil), projectNativeStaticDefaultCallNames...),
		CallInterests:            projectNativeStaticDefaultCallInterests(),
		ConstructorNames:         []string{"Agent"},
		ConstructorInterests:     projectNativeStaticDefaultConstructorInterests(),
		PruneNativeFactCallNames: []string{"cascade", "fallback", "router"},
		SyntaxFrontend:           projectNativeStaticSyntaxFrontend(),
		NativeAstEnabled:         config.NativeAstEnabled,
		StaticInterests:          projectNativeStaticDefaultStaticInterests(),
		RelationSpecs:            nil,
		RuleDescriptors:          nil,
		LintConfig:               append(json.RawMessage(nil), config.Lint...),
		CacheInputs:              cacheInputs,
		StaticHost:               projectNativeStaticDefaultHost(),
	}
	if config.NativeAstEnabled && extensionManifest != nil {
		if err := projectNativeStaticMergeExtensionHostManifest(&plan, *extensionManifest); err != nil {
			return Result{}, err
		}
	}

	fileSelectionStarted := time.Now()
	var fileSelectionCallNames []string
	if extensionManifest != nil {
		fileSelectionCallNames = plan.CallNames
	}
	selection, selectionTimings, err := projectNativeStaticFileSelectionWithCallNamesTimed(
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
	sourceGraph, err := json.Marshal(projectNativeStaticBuildSourceGraph(root))
	if err != nil {
		return Result{}, fmt.Errorf("encode native static source graph: %w", err)
	}
	timings = AppendTiming(timings, TimingSourceGraph, sourceGraphStarted, 1)
	plan.SourceGraph = sourceGraph

	if config.NativeAstEnabled && staticcache.StatusEnabledFromEnv() {
		cacheStarted := time.Now()
		applyCacheManifestStatus(&plan)
		timings = AppendTiming(timings, TimingCacheStatus, cacheStarted, len(plan.PrimaryFiles))
	}
	return Result{Plan: plan, Timings: timings}, nil
}

func applyCacheManifestStatus(plan *devtools.ProjectStaticSyntaxPlan) {
	if plan == nil || len(plan.CacheInputs) == 0 {
		return
	}
	primaryFiles := plan.PrimaryFiles
	if len(primaryFiles) == 0 {
		primaryFiles = plan.Files
	}
	cacheStatus := staticcache.ManifestStatus(plan.Root, primaryFiles, plan.CacheInputs)
	plan.CacheHits = cacheStatus.CacheHits
	plan.CacheMisses = cacheStatus.CacheMisses
	plan.CacheEntries = cacheStatus.CacheEntries
	plan.FilesToParse = staticcache.FilesToParse(cacheStatus.CacheMisses, plan.Files, primaryFiles)
}

func RefreshFileSelection(
	plan *devtools.ProjectStaticSyntaxPlan,
	root string,
	configFile string,
) error {
	selection, err := projectNativeStaticFileSelectionWithCallNames(root, configFile, plan.CallNames)
	if err != nil {
		return err
	}
	plan.Files = selection.Files
	plan.PrimaryFiles = selection.PrimaryFiles
	plan.Skipped = selection.Skipped
	return nil
}
