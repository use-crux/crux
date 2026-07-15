package service

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) ReindexProject(ctx context.Context, root, configPath, projectName string) (store.IndexData, error) {
	return s.ReindexProjectWithOptions(ctx, root, configPath, projectName, ProjectReindexOptions{})
}

func (s *Service) ReindexProjectWithOptions(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	options ProjectReindexOptions,
) (store.IndexData, error) {
	s.setSemanticMode(options.semanticMode())
	return s.pipeline().reindexProjectWithOptions(ctx, root, configPath, projectName, options)
}

func (s *Service) ReindexProjectIncremental(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	files []string,
	deletedFiles []string,
) (store.IndexData, error) {
	return s.ReindexProjectIncrementalWithOptions(ctx, root, configPath, projectName, files, deletedFiles, ProjectReindexOptions{})
}

func (s *Service) ReindexProjectIncrementalWithOptions(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	files []string,
	deletedFiles []string,
	options ProjectReindexOptions,
) (store.IndexData, error) {
	s.setSemanticMode(options.semanticMode())
	return s.pipeline().reindexProjectIncrementalWithOptions(ctx, root, configPath, projectName, files, deletedFiles, options)
}

func (s *Service) ReindexProjectRuntimeRich(ctx context.Context, root, configPath, projectName string) (store.IndexData, error) {
	s.setSemanticMode(ProjectSemanticInline)
	return s.pipeline().reindexProjectRuntimeRich(ctx, root, configPath, projectName)
}
