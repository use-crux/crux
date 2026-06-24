package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

const projectIndexerSyntaxWorkerEnv = "CRUX_INDEXER_SYNTAX_WORKER"
const projectIndexerSyntaxWorkerPoolSizeEnv = "CRUX_INDEXER_SYNTAX_WORKER_POOL_SIZE"
const projectIndexerNativeStaticCacheStatusEnv = "CRUX_INDEXER_NATIVE_STATIC_CACHE_STATUS"

var osExecutable = os.Executable

// WithProjectSyntaxWorker enables the native Rust/Oxc static syntax path.
func (w *ProjectIndexWorker) WithProjectSyntaxWorker(worker ProjectSyntaxParser) *ProjectIndexWorker {
	w.syntaxWorker = worker
	return w
}

func projectSyntaxWorkerFromEnv() ProjectSyntaxParser {
	commandPath, ok := projectSyntaxWorkerCommandPath()
	if !ok {
		return nil
	}
	if strings.TrimSpace(os.Getenv(projectIndexerSyntaxWorkerPoolSizeEnv)) == "" {
		return NewAdaptiveProjectSyntaxWorkerPool(defaultProjectSyntaxWorkerPoolSize(), commandPath, "serve")
	}
	return NewProjectSyntaxWorkerPool(projectSyntaxWorkerPoolSizeFromEnv(), commandPath, "serve")
}

func projectSyntaxWorkerCommandPath() (string, bool) {
	if explicit := strings.TrimSpace(os.Getenv(projectIndexerSyntaxWorkerEnv)); explicit != "" {
		return explicit, true
	}
	executable, err := osExecutable()
	if err != nil || executable == "" {
		return "", false
	}
	candidate := filepath.Join(filepath.Dir(executable), projectSyntaxWorkerBinaryName())
	info, err := os.Stat(candidate)
	if err != nil || info.IsDir() {
		return "", false
	}
	return candidate, true
}

func projectSyntaxWorkerBinaryName() string {
	if runtime.GOOS == "windows" {
		return "crux-indexer-syntax.exe"
	}
	return "crux-indexer-syntax"
}

func projectSyntaxWorkerPoolSizeFromEnv() int {
	explicit := strings.TrimSpace(os.Getenv(projectIndexerSyntaxWorkerPoolSizeEnv))
	if explicit == "" {
		return defaultProjectSyntaxWorkerPoolSize()
	}
	size, err := strconv.Atoi(explicit)
	if err != nil || size < 1 {
		slog.Warn("invalid project syntax worker pool size", "env", projectIndexerSyntaxWorkerPoolSizeEnv, "value", explicit)
		return defaultProjectSyntaxWorkerPoolSize()
	}
	return size
}

func defaultProjectSyntaxWorkerPoolSize() int {
	size := runtime.GOMAXPROCS(0)
	if size < 1 {
		return 1
	}
	if size > 4 {
		return 4
	}
	return size
}

func nativeStaticCacheStatusEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(projectIndexerNativeStaticCacheStatusEnv)))
	return value != "0" && value != "false" && value != "off"
}

// InspectProjectStaticSyntaxPlan returns the static parser plan used by the
// native syntax worker path.
func (w *ProjectIndexWorker) InspectProjectStaticSyntaxPlan(ctx context.Context, root, configPath, projectName string) (devtools.ProjectStaticSyntaxPlan, error) {
	result, err := w.inspectProjectStaticSyntaxPlan(ctx, root, configPath, projectName)
	if err != nil {
		return devtools.ProjectStaticSyntaxPlan{}, err
	}
	return result.Plan, nil
}

// InspectProjectNativeStaticConfig imports only executable config policy needed
// by Go/Rust-owned native static planning.
func (w *ProjectIndexWorker) InspectProjectNativeStaticConfig(ctx context.Context, root, configPath string) (devtools.ProjectNativeStaticConfig, error) {
	req := projectIndexRequest{
		Method:     "inspectProjectNativeStaticConfig",
		Root:       root,
		ConfigPath: configPath,
	}
	resp, err := w.streamArtifact(ctx, req, devtools.ProjectIndexArtifactNativeStaticConfig)
	if err != nil {
		return devtools.ProjectNativeStaticConfig{}, err
	}
	var config devtools.ProjectNativeStaticConfig
	if err := json.Unmarshal(resp, &config); err != nil {
		return devtools.ProjectNativeStaticConfig{}, fmt.Errorf("decode project native static config: %w", err)
	}
	return config, nil
}

func (w *ProjectIndexWorker) indexProjectAstPatchResultFromNativeSyntaxRecords(ctx context.Context, root, configPath, projectName string) (devtools.ProjectAstIndexResult, error) {
	started := time.Now()
	planStarted := time.Now()
	planResult, err := w.inspectProjectStaticSyntaxPlan(ctx, root, configPath, projectName)
	if err != nil {
		return devtools.ProjectAstIndexResult{}, err
	}
	plan := planResult.Plan
	timing := ProjectIndexAstTiming{
		PlanMs:             elapsedMs(planStarted),
		NodeTimings:        append([]devtools.ProjectIndexPhaseTiming(nil), planResult.Timings...),
		NativeOnlyEligible: projectStaticPlanNativeOnlyEligible(plan),
	}
	for _, reason := range planResult.NodeReasons {
		timing = projectIndexAstTimingNodeRequired(timing, reason)
	}
	if !plan.NativeAstEnabled {
		patch, err := w.indexProjectAstPatchFromTypeScript(ctx, root, configPath, projectName)
		fallbackTiming := w.LastAstTiming()
		fallbackTiming.PlanMs = timing.PlanMs
		fallbackTiming.NodeTimings = append(planResult.Timings, fallbackTiming.NodeTimings...)
		for _, reason := range planResult.NodeReasons {
			fallbackTiming = projectIndexAstTimingNodeRequired(fallbackTiming, reason)
		}
		fallbackTiming.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(fallbackTiming)
		if err != nil {
			return devtools.ProjectAstIndexResult{}, err
		}
		return devtools.ProjectAstIndexResult{Patch: patch}, nil
	}
	compiler, ok := w.syntaxWorker.(ProjectNativeStaticCompiler)
	if !ok {
		timing.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(timing)
		return devtools.ProjectAstIndexResult{}, fmt.Errorf("nativeAst indexing requires a native static compiler; syntax-record projection fallback is disabled")
	}

	if !projectStaticPlanNativeStaticSchedulable(plan) {
		timing.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(timing)
		return devtools.ProjectAstIndexResult{}, fmt.Errorf("native static AST indexing is not schedulable for this static plan; syntax-record projection fallback is disabled")
	}

	patch, nativeTiming, usedNativeStatic, err := w.indexProjectAstPatchFromNativeStaticCompiler(ctx, root, configPath, projectName, plan, compiler)
	nativeTiming.PlanMs = timing.PlanMs
	nativeTiming.NodeTimings = append(planResult.Timings, nativeTiming.NodeTimings...)
	nativeTiming.NativeOnlyEligible = timing.NativeOnlyEligible
	for _, reason := range planResult.NodeReasons {
		nativeTiming = projectIndexAstTimingNodeRequired(nativeTiming, reason)
	}
	nativeTiming.TotalMs = elapsedMs(started)
	if err != nil {
		w.recordLastAstTiming(nativeTiming)
		return devtools.ProjectAstIndexResult{}, err
	}
	if usedNativeStatic {
		nativeTiming.UsedNativeStatic = true
		w.recordLastAstTiming(nativeTiming)
		return devtools.ProjectAstIndexResult{Patch: patch, UsedNativeStatic: true}, nil
	}
	w.recordLastAstTiming(nativeTiming)
	return devtools.ProjectAstIndexResult{}, fmt.Errorf(
		"native static AST indexing did not produce a complete patch; syntax-record projection fallback is disabled (reasons: %s)",
		strings.Join(nativeTiming.NodeReasons, ", "),
	)
}

func elapsedMs(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}
