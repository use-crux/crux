package server

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

type projectStaticSyntaxPlanResult struct {
	Plan        devtools.ProjectStaticSyntaxPlan
	Timings     []devtools.ProjectIndexPhaseTiming
	NodeStarted bool
	NodeReasons []string
}

type projectNativeStaticSyntaxPlanResult struct {
	Plan    devtools.ProjectStaticSyntaxPlan
	Timings []devtools.ProjectIndexPhaseTiming
}

func (w *ProjectIndexWorker) inspectProjectStaticSyntaxPlan(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (projectStaticSyntaxPlanResult, error) {
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return projectStaticSyntaxPlanResult{}, fmt.Errorf("resolve project root for native static plan: %w", err)
	}
	key := projectStaticSyntaxPlanKey{root: absoluteRoot, configPath: configPath, projectName: projectName}
	return w.sharedProjectStaticSyntaxPlan(ctx, key, func(ctx context.Context) (projectStaticSyntaxPlanResult, error) {
		return w.inspectProjectStaticSyntaxPlanUnshared(ctx, absoluteRoot, configPath, projectName)
	})
}

func (w *ProjectIndexWorker) inspectProjectStaticSyntaxPlanUnshared(
	ctx context.Context,
	absoluteRoot string,
	configPath string,
	projectName string,
) (projectStaticSyntaxPlanResult, error) {
	config := devtools.ProjectNativeStaticConfig{Root: absoluteRoot}
	timings := []devtools.ProjectIndexPhaseTiming{}
	nodeReasons := []string{}
	if projectNativeStaticConfigMayRequireNode(absoluteRoot, configPath) {
		configStarted := time.Now()
		if loaded, ok, err := projectNativeStaticInspectSimpleConfig(absoluteRoot, configPath); err != nil {
			return projectStaticSyntaxPlanResult{}, err
		} else if ok {
			config = loaded
		} else {
			loaded, err := w.InspectProjectNativeStaticConfig(ctx, absoluteRoot, configPath)
			if err != nil {
				return projectStaticSyntaxPlanResult{}, err
			}
			config = loaded
			nodeReasons = append(nodeReasons, projectIndexNodeReasonNativeStaticConfig)
		}
		timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingConfig, configStarted, 1)
	}

	var extensionManifest *devtools.StaticExtensionHostManifestResult
	if len(config.Extensions) > 0 && config.NativeAstEnabled {
		manifestStarted := time.Now()
		manifest, err := w.projectNativeStaticExtensionHostManifest(ctx, absoluteRoot, configPath)
		if err != nil {
			return projectStaticSyntaxPlanResult{}, err
		}
		extensionManifest = &manifest
		timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingExtensionManifest, manifestStarted, 1)
		nodeReasons = append(nodeReasons, projectIndexNodeReasonNativeStaticExtensions)
	}

	planResult, err := projectNativeStaticSyntaxPlanWithTimingsAndExtensionManifest(
		absoluteRoot,
		projectName,
		config,
		extensionManifest,
	)
	if err != nil {
		return projectStaticSyntaxPlanResult{}, err
	}
	plan := planResult.Plan
	timings = append(timings, planResult.Timings...)
	return projectStaticSyntaxPlanResult{
		Plan:        plan,
		Timings:     timings,
		NodeStarted: len(nodeReasons) > 0,
		NodeReasons: nodeReasons,
	}, nil
}

func projectNativeStaticSyntaxPlan(
	root string,
	projectName string,
	config devtools.ProjectNativeStaticConfig,
) (devtools.ProjectStaticSyntaxPlan, error) {
	result, err := projectNativeStaticSyntaxPlanWithTimings(root, projectName, config)
	if err != nil {
		return devtools.ProjectStaticSyntaxPlan{}, err
	}
	return result.Plan, nil
}

func projectNativeStaticSyntaxPlanWithTimings(
	root string,
	projectName string,
	config devtools.ProjectNativeStaticConfig,
) (projectNativeStaticSyntaxPlanResult, error) {
	return projectNativeStaticSyntaxPlanWithTimingsAndExtensionManifest(root, projectName, config, nil)
}

func projectNativeStaticSyntaxPlanWithTimingsAndExtensionManifest(
	root string,
	projectName string,
	config devtools.ProjectNativeStaticConfig,
	extensionManifest *devtools.StaticExtensionHostManifestResult,
) (projectNativeStaticSyntaxPlanResult, error) {
	timings := []devtools.ProjectIndexPhaseTiming{}
	var cacheInputs []json.RawMessage
	if config.NativeAstEnabled {
		cacheInputs = projectNativeStaticDefaultCacheCompilerInputs()
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
			return projectNativeStaticSyntaxPlanResult{}, err
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
		return projectNativeStaticSyntaxPlanResult{}, err
	}
	timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingFileSelection, fileSelectionStarted, len(selection.Files))
	timings = append(timings, selectionTimings...)
	plan.Files = selection.Files
	plan.PrimaryFiles = selection.PrimaryFiles
	plan.Skipped = selection.Skipped

	sourceGraphStarted := time.Now()
	sourceGraph, err := json.Marshal(projectNativeStaticBuildSourceGraph(root))
	if err != nil {
		return projectNativeStaticSyntaxPlanResult{}, fmt.Errorf("encode native static source graph: %w", err)
	}
	timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingSourceGraph, sourceGraphStarted, 1)
	plan.SourceGraph = sourceGraph

	if config.NativeAstEnabled && nativeStaticCacheStatusEnabled() {
		cacheStarted := time.Now()
		projectNativeStaticApplyCacheManifestStatus(&plan)
		timings = projectNativeStaticAppendPlanTiming(timings, projectNativeStaticPlanTimingCacheStatus, cacheStarted, len(plan.PrimaryFiles))
	}
	return projectNativeStaticSyntaxPlanResult{Plan: plan, Timings: timings}, nil
}

func projectNativeStaticApplyCacheManifestStatus(plan *devtools.ProjectStaticSyntaxPlan) {
	if plan == nil || len(plan.CacheInputs) == 0 {
		return
	}
	primaryFiles := plan.PrimaryFiles
	if len(primaryFiles) == 0 {
		primaryFiles = plan.Files
	}
	cacheStatus := projectNativeStaticCacheManifestStatus(plan.Root, primaryFiles, plan.CacheInputs)
	plan.CacheHits = cacheStatus.CacheHits
	plan.CacheMisses = cacheStatus.CacheMisses
	plan.CacheEntries = cacheStatus.CacheEntries
	plan.FilesToParse = projectNativeStaticFilesToParseFromCacheStatus(cacheStatus.CacheMisses, plan.Files, primaryFiles)
}

func projectNativeStaticRefreshFileSelection(
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
