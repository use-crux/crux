package devtools

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/projectindex/service"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ProjectSemanticExecutionMode controls how a Project Index refresh runs
// semantic enrichment after the AST/source patch is available.
type ProjectSemanticExecutionMode = service.ProjectSemanticExecutionMode

const (
	// ProjectSemanticInline applies semantic enrichment before ReindexProject returns.
	ProjectSemanticInline = service.ProjectSemanticInline
	// ProjectSemanticBackground schedules semantic enrichment after publishing AST facts.
	ProjectSemanticBackground = service.ProjectSemanticBackground
	// ProjectSemanticDisabled skips semantic enrichment for this refresh.
	ProjectSemanticDisabled = service.ProjectSemanticDisabled
)

// ProjectReindexOptions configures a Project Index refresh.
type ProjectReindexOptions = service.ProjectReindexOptions

// ProjectWatchRunOptions carries watcher-owned run identity and queue
// coalescing telemetry into a Project Index refresh.
type ProjectWatchRunOptions = service.ProjectWatchRunOptions

func (s *Service) ReindexProject(ctx context.Context, root, configPath, projectName string) (store.IndexData, error) {
	return s.indexService.ReindexProject(ctx, root, configPath, projectName)
}

func (s *Service) ReindexProjectWithOptions(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	options ProjectReindexOptions,
) (store.IndexData, error) {
	return s.indexService.ReindexProjectWithOptions(ctx, root, configPath, projectName, options)
}

func (s *Service) ReindexProjectIncremental(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	files []string,
	deletedFiles []string,
) (store.IndexData, error) {
	return s.indexService.ReindexProjectIncremental(ctx, root, configPath, projectName, files, deletedFiles)
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
	return s.indexService.ReindexProjectIncrementalWithOptions(ctx, root, configPath, projectName, files, deletedFiles, options)
}

func (s *Service) ReindexProjectRuntimeRich(ctx context.Context, root, configPath, projectName string) (store.IndexData, error) {
	return s.indexService.ReindexProjectRuntimeRich(ctx, root, configPath, projectName)
}
