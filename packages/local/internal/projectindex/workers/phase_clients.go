package workers

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (w *Bundle) IndexProjectSemanticPatch(ctx context.Context, request projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	if w.semanticWorker == nil {
		return projectindex.IndexPatch{}, fmt.Errorf("project semantic worker is not configured")
	}
	return w.semanticWorker.IndexProjectSemanticPatch(ctx, request)
}

// AcquireEvalDiscoveryCapacity coordinates Eval discovery with saturated
// semantic compiler work.
func (w *Bundle) AcquireEvalDiscoveryCapacity(ctx context.Context) (func(), error) {
	if w == nil || w.semanticWorker == nil {
		return func() {}, nil
	}
	return w.semanticWorker.AcquireEvalDiscoveryCapacity(ctx)
}

// AcquireContendedCompilerCapacity coordinates other CPU-heavy compiler work
// with Eval discovery on projects that saturate semantic worker capacity.
func (w *Bundle) AcquireContendedCompilerCapacity(ctx context.Context) (func(), error) {
	if w == nil || w.semanticWorker == nil {
		return func() {}, nil
	}
	return w.semanticWorker.AcquireContendedCompilerCapacity(ctx)
}

// EvalDiscoveryIsolationRequired reports whether full-pool semantic demand has
// been observed for this project.
func (w *Bundle) EvalDiscoveryIsolationRequired() bool {
	return w != nil && w.semanticWorker != nil && w.semanticWorker.EvalDiscoveryIsolationRequired()
}

// PrepareEvalDiscoveryIsolation publishes full-pool semantic demand before the
// orchestrator exposes its AST snapshot as ready.
func (w *Bundle) PrepareEvalDiscoveryIsolation(request projectindex.ProjectSemanticIndexRequest) {
	if w != nil && w.semanticWorker != nil {
		w.semanticWorker.PrepareEvalDiscoveryIsolation(request)
	}
}

func (w *Bundle) IndexProjectRuntimePatch(ctx context.Context, request projectindex.ProjectRuntimeIndexRequest) (projectindex.IndexPatch, error) {
	if w.runtimeWorker == nil {
		return projectindex.IndexPatch{}, fmt.Errorf("project runtime worker is not configured")
	}
	return w.runtimeWorker.IndexProjectRuntimePatch(ctx, request)
}

func (w *Bundle) IndexProjectIncremental(ctx context.Context, root, configPath, projectName string, previousIndex store.IndexData, files []string, deletedFiles []string, mode string) (projectindex.ProjectIndexIncrementalResult, error) {
	if mode == "" {
		mode = "ast"
	}
	if w.canUseStaticIndexIncremental(previousIndex, mode) {
		return w.indexProjectIncrementalFromStaticIndex(ctx, root, configPath, projectName, previousIndex, files, deletedFiles)
	}
	return projectindex.ProjectIndexIncrementalResult{}, fmt.Errorf("Static Index incremental is unavailable for this request")
}
