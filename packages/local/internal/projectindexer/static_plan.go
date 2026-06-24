package projectindexer

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticplan"
)

type projectStaticSyntaxPlanResult struct {
	Plan        devtools.ProjectStaticSyntaxPlan
	Timings     []devtools.ProjectIndexPhaseTiming
	NodeStarted bool
	NodeReasons []string
}

func (w *Worker) inspectProjectStaticSyntaxPlan(
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

func (w *Worker) inspectProjectStaticSyntaxPlanUnshared(
	ctx context.Context,
	absoluteRoot string,
	configPath string,
	projectName string,
) (projectStaticSyntaxPlanResult, error) {
	config := devtools.ProjectNativeStaticConfig{Root: absoluteRoot}
	timings := []devtools.ProjectIndexPhaseTiming{}
	nodeReasons := []string{}
	if staticplan.ConfigMayRequireNode(absoluteRoot, configPath) {
		configStarted := time.Now()
		if loaded, ok, err := staticplan.InspectSimpleConfig(absoluteRoot, configPath); err != nil {
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
		timings = staticplan.AppendTiming(timings, staticplan.TimingConfig, configStarted, 1)
	}

	var extensionManifest *devtools.StaticExtensionHostManifestResult
	if len(config.Extensions) > 0 && config.NativeAstEnabled {
		manifestStarted := time.Now()
		manifest, err := w.projectNativeStaticExtensionHostManifest(ctx, absoluteRoot, configPath)
		if err != nil {
			return projectStaticSyntaxPlanResult{}, err
		}
		extensionManifest = &manifest
		timings = staticplan.AppendTiming(timings, staticplan.TimingExtensionManifest, manifestStarted, 1)
		nodeReasons = append(nodeReasons, projectIndexNodeReasonNativeStaticExtensions)
	}

	planResult, err := staticplan.BuildWithExtensionManifest(
		absoluteRoot,
		projectName,
		config,
		extensionManifest,
	)
	if err != nil {
		return projectStaticSyntaxPlanResult{}, err
	}
	timings = append(timings, planResult.Timings...)
	return projectStaticSyntaxPlanResult{
		Plan:        planResult.Plan,
		Timings:     timings,
		NodeStarted: len(nodeReasons) > 0,
		NodeReasons: nodeReasons,
	}, nil
}
