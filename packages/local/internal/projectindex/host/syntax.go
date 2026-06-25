package host

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/compiler"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

// WithSyntaxParser overrides the parser used for static syntax records.
func (w *Worker) WithSyntaxParser(worker syntax.Parser) *Worker {
	w.syntaxParser = worker
	return w
}

func syntaxWorkerFromEnv() syntax.Parser {
	commandPath, ok := syntax.CommandPathFromEnv()
	if !ok {
		return nil
	}
	if syntax.UseAdaptivePoolFromEnv() {
		return compiler.NewAdaptivePool(syntax.DefaultPoolSize(), commandPath, "serve")
	}
	return compiler.NewPool(syntax.PoolSizeFromEnv(), commandPath, "serve")
}

// InspectProjectStaticSyntaxPlan returns the static parser plan used by the
// Rust/Oxc indexer worker path.
func (w *Worker) InspectProjectStaticSyntaxPlan(ctx context.Context, root, configPath, projectName string) (projectindex.ProjectStaticSyntaxPlan, error) {
	result, err := w.inspectProjectStaticSyntaxPlan(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.ProjectStaticSyntaxPlan{}, err
	}
	return result.Plan, nil
}

// InspectProjectNativeStaticConfig imports only executable config policy needed
// by Go/Rust-owned native static planning.
func (w *Worker) InspectProjectNativeStaticConfig(ctx context.Context, root, configPath string) (projectindex.ProjectNativeStaticConfig, error) {
	return planner.LoadConfig(ctx, planner.ArtifactReaderFunc(w.streamArtifact), root, configPath)
}

func (w *Worker) indexProjectAstPatchResultFromNativeSyntaxRecords(ctx context.Context, root, configPath, projectName string) (projectindex.ProjectAstIndexResult, error) {
	started := time.Now()
	planStarted := time.Now()
	planResult, err := w.inspectProjectStaticSyntaxPlan(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.ProjectAstIndexResult{}, err
	}
	plan := planResult.Plan
	timing := ProjectIndexAstTiming{
		PlanMs:             elapsedMs(planStarted),
		NodeTimings:        append([]projectindex.ProjectIndexPhaseTiming(nil), planResult.Timings...),
		NativeOnlyEligible: compat.NativeOnlyEligible(plan),
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
			return projectindex.ProjectAstIndexResult{}, err
		}
		return projectindex.ProjectAstIndexResult{Patch: patch}, nil
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		timing.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(timing)
		return projectindex.ProjectAstIndexResult{}, fmt.Errorf("nativeAst indexing requires a native static compiler; syntax-record projection fallback is disabled")
	}

	if !compat.Schedulable(plan) {
		timing.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(timing)
		return projectindex.ProjectAstIndexResult{}, fmt.Errorf("native static AST indexing is not schedulable for this static plan; syntax-record projection fallback is disabled")
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
		return projectindex.ProjectAstIndexResult{}, err
	}
	if usedNativeStatic {
		nativeTiming.UsedNativeStatic = true
		w.recordLastAstTiming(nativeTiming)
		return projectindex.ProjectAstIndexResult{Patch: patch, UsedNativeStatic: true}, nil
	}
	w.recordLastAstTiming(nativeTiming)
	return projectindex.ProjectAstIndexResult{}, fmt.Errorf(
		"native static AST indexing did not produce a complete patch; syntax-record projection fallback is disabled (reasons: %s)",
		strings.Join(nativeTiming.NodeReasons, ", "),
	)
}

func elapsedMs(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}
