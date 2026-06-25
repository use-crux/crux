package server

import (
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host"
)

// NewEmbeddedProjectIndexer creates the local Project Index host with the
// scripts embedded by the local runtime.
func NewEmbeddedProjectIndexer(scriptPath string) *host.Bundle {
	return assets.NewProjectIndexer(assets.ProjectIndexerOptions{
		ScriptPath: scriptPath,
		Assets: assets.ProjectIndexerAssets{
			ProjectIndexer:         embeddedProjectIndexer,
			ProjectSemanticIndexer: embeddedProjectSemanticIndexer,
			ProjectRuntimeIndexer:  embeddedProjectRuntimeIndexer,
		},
	})
}
