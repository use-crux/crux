package host

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	staticclient "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/client"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/session"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

// WithSyntaxParser overrides the parser used for static syntax records.
func (w *Bundle) WithSyntaxParser(worker syntax.Parser) *Bundle {
	w.syntaxParser = worker
	return w
}

func syntaxWorkerFromEnv() syntax.Parser {
	commandPath, ok := syntax.CommandPathFromEnv()
	if !ok {
		return nil
	}
	if syntax.UseAdaptivePoolFromEnv() {
		return staticclient.NewAdaptivePool(syntax.DefaultPoolSize(), commandPath, "serve")
	}
	return staticclient.NewPool(syntax.PoolSizeFromEnv(), commandPath, "serve")
}

// InspectProjectStaticSyntaxPlan returns the static parser plan used by the
// Rust/Oxc indexer worker path.
func (w *Bundle) InspectProjectStaticSyntaxPlan(ctx context.Context, root, configPath, projectName string) (projectindex.ProjectStaticSyntaxPlan, error) {
	result, err := w.inspectProjectStaticSyntaxPlan(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.ProjectStaticSyntaxPlan{}, err
	}
	return result.Plan, nil
}

// InspectProjectStaticIndexConfig imports only executable config policy needed
// by Go/Rust-owned Static Index planning.
func (w *Bundle) InspectProjectStaticIndexConfig(ctx context.Context, root, configPath string) (projectindex.ProjectStaticIndexConfig, error) {
	return planner.LoadConfig(ctx, planner.ArtifactReaderFunc(w.streamArtifact), root, configPath)
}

func (w *Bundle) indexProjectAstPatchResultFromNativeSyntaxRecords(ctx context.Context, root, configPath, projectName string) (projectindex.ProjectAstIndexResult, error) {
	started := time.Now()
	planStarted := time.Now()
	var compiler StaticCompiler
	if w != nil {
		compiler, _ = w.syntaxParser.(StaticCompiler)
	}
	result, err := w.staticIndexSession(root, configPath, projectName, compiler).Run(ctx)
	if err != nil && result.Status == "" {
		return projectindex.ProjectAstIndexResult{}, err
	}
	timing := projectIndexAstTimingFromStaticIndexSession(result)
	timing.PlanMs = elapsedMs(planStarted)
	if result.Status == session.StatusDisabled {
		patch, err := w.indexProjectAstPatchFromTypeScript(ctx, root, configPath, projectName)
		fallbackTiming := w.LastAstTiming()
		fallbackTiming.PlanMs = timing.PlanMs
		fallbackTiming.NodeTimings = append(result.PlanTimings, fallbackTiming.NodeTimings...)
		for _, reason := range result.NodeReasons {
			fallbackTiming = projectIndexAstTimingNodeRequired(fallbackTiming, reason)
		}
		fallbackTiming.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(fallbackTiming)
		if err != nil {
			return projectindex.ProjectAstIndexResult{}, err
		}
		return projectindex.ProjectAstIndexResult{Patch: patch}, nil
	}
	if result.Status == session.StatusMissingCompiler {
		timing = projectIndexAstTimingNativeOnlyBlocked(timing, projectIndexNativeOnlyReasonStaticIndexCompilerSetup)
		timing.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(timing)
		return projectindex.ProjectAstIndexResult{}, fmt.Errorf("nativeAst indexing requires a Static Index compiler; syntax-record projection fallback is disabled")
	}
	if result.Status == session.StatusUnschedulable {
		timing.TotalMs = elapsedMs(started)
		w.recordLastAstTiming(timing)
		return projectindex.ProjectAstIndexResult{}, fmt.Errorf("Static Index AST indexing is not schedulable for this static plan; syntax-record projection fallback is disabled")
	}
	timing.TotalMs = elapsedMs(started)
	if err != nil {
		w.recordLastAstTiming(timing)
		return projectindex.ProjectAstIndexResult{}, err
	}
	if result.UsedStaticIndex {
		timing.UsedStaticIndex = true
		w.recordLastAstTiming(timing)
		return projectindex.ProjectAstIndexResult{Patch: result.Patch, UsedStaticIndex: true}, nil
	}
	w.recordLastAstTiming(timing)
	return projectindex.ProjectAstIndexResult{}, fmt.Errorf(
		"Static Index AST indexing did not produce a complete patch; syntax-record projection fallback is disabled (reasons: %s)",
		strings.Join(timing.NodeReasons, ", "),
	)
}

func elapsedMs(started time.Time) float64 {
	return float64(time.Since(started).Microseconds()) / 1000
}
