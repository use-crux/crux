package host

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (w *Bundle) IndexProjectSemanticPatch(ctx context.Context, request projectindex.ProjectSemanticIndexRequest) (projectindex.IndexPatch, error) {
	if w.semanticWorker == nil {
		return projectindex.IndexPatch{}, fmt.Errorf("project semantic worker is not configured")
	}
	return w.semanticWorker.IndexProjectSemanticPatch(ctx, request)
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
	req := indexwire.Request{
		Method:        "indexProjectIncremental",
		Root:          root,
		ConfigPath:    configPath,
		ProjectName:   projectName,
		PreviousIndex: &previousIndex,
		Files:         files,
		DeletedFiles:  deletedFiles,
		Mode:          mode,
	}
	collector, err := w.streamCollector(ctx, req, projectindex.IndexPatchBudget{})
	if err != nil {
		return projectindex.ProjectIndexIncrementalResult{}, err
	}
	return collector.IncrementalResult()
}
