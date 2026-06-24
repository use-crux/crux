package devtools

import (
	"context"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

func (s *Service) indexProjectAstPatch(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (projectindex.ProjectAstIndexResult, error) {
	if indexer, ok := s.indexer.(projectindex.ProjectAstResultIndexer); ok {
		return indexer.IndexProjectAstPatchWithResult(ctx, root, configPath, projectName)
	}
	patch, err := s.indexer.IndexProjectAstPatch(ctx, root, configPath, projectName)
	if err != nil {
		return projectindex.ProjectAstIndexResult{}, err
	}
	return projectindex.ProjectAstIndexResult{Patch: patch}, nil
}
