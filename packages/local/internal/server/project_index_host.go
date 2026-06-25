package server

import (
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host"
)

// NewEmbeddedProjectIndexer creates the local Project Index worker with the
// scripts embedded by the local runtime.
func NewEmbeddedProjectIndexer(scriptPath string) *host.Worker {
	return assets.NewProjectIndexer(assets.ProjectIndexerOptions{
		ScriptPath: scriptPath,
		Assets: assets.ProjectIndexerAssets{
			ProjectIndexer:         embeddedProjectIndexer,
			ProjectSemanticIndexer: embeddedProjectSemanticIndexer,
			ProjectRuntimeIndexer:  embeddedProjectRuntimeIndexer,
		},
	})
}
