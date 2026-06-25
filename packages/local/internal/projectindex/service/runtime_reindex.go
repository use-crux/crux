package service

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (p projectIndexPipeline) reindexProjectRuntimeRich(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
) (store.IndexData, error) {
	s := p.service
	index, err := p.reindexProjectWithOptions(ctx, root, configPath, projectName, ProjectReindexOptions{
		Semantic: ProjectSemanticInline,
	})
	if err != nil {
		return store.IndexData{}, err
	}
	return s.applyProjectRuntimePatch(ctx, projectindex.ProjectRuntimeIndexRequest{
		Root:          root,
		ConfigPath:    configPath,
		ProjectName:   projectName,
		Budget:        ProjectIndexRuntimeBudget,
		PreviousIndex: index,
	})
}
