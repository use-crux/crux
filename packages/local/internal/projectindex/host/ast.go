package host

import (
	"context"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
)

func (w *Bundle) IndexProjectAstPatch(ctx context.Context, root, configPath, projectName string) (projectindex.IndexPatch, error) {
	result, err := w.IndexProjectAstPatchWithResult(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	return result.Patch, nil
}

// IndexProjectAstPatchWithResult returns the AST/source patch with per-run
// metadata used by later phases. Unlike LastAstTiming, this result belongs to
// the current call and is safe to pass through concurrent service scheduling.
func (w *Bundle) IndexProjectAstPatchWithResult(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (projectindex.ProjectAstIndexResult, error) {
	if w.syntaxParser != nil {
		return w.indexProjectAstPatchResultFromNativeSyntaxRecords(ctx, root, configPath, projectName)
	}
	patch, err := w.indexProjectAstPatchFromTypeScript(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.ProjectAstIndexResult{}, err
	}
	return projectindex.ProjectAstIndexResult{Patch: patch}, nil
}

func (w *Bundle) indexProjectAstPatchFromTypeScript(ctx context.Context, root, configPath, projectName string) (projectindex.IndexPatch, error) {
	started := time.Now()
	req := indexwire.Request{
		Method:         "indexProjectAst",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "source-only",
	}
	collector, err := w.streamCollector(ctx, req, projectindex.IndexPatchBudget{})
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	patches, err := collector.Patches()
	if err != nil {
		return projectindex.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, fmt.Errorf("project ast worker returned %d patches, want 1", len(patches))
	}
	w.recordLastAstTiming(projectIndexAstTimingNodeRequired(ProjectIndexAstTiming{
		TotalMs:     elapsedMs(started),
		NodeTimings: collector.Timings(),
	}, projectIndexNodeReasonTypeScriptStaticCompiler))
	return patches[0], nil
}
