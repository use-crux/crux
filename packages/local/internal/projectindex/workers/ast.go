package workers

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
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
	return w.indexProjectAstPatchResultFromNativeSyntaxRecords(ctx, root, configPath, projectName)
}
