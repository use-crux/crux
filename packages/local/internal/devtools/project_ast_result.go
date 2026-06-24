package devtools

import "context"

func (s *Service) indexProjectAstPatch(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (ProjectAstIndexResult, error) {
	if indexer, ok := s.indexer.(ProjectAstResultIndexer); ok {
		return indexer.IndexProjectAstPatchWithResult(ctx, root, configPath, projectName)
	}
	patch, err := s.indexer.IndexProjectAstPatch(ctx, root, configPath, projectName)
	if err != nil {
		return ProjectAstIndexResult{}, err
	}
	return ProjectAstIndexResult{Patch: patch}, nil
}
