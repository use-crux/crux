package server

import (
	"github.com/use-crux/crux/packages/local/internal/indexhost"
	"github.com/use-crux/crux/packages/local/internal/localassets"
)

// NewEmbeddedProjectIndexer creates the local Project Index worker with the
// scripts embedded by the local runtime.
func NewEmbeddedProjectIndexer(scriptPath string) *indexhost.Worker {
	return localassets.NewProjectIndexer(localassets.ProjectIndexerOptions{
		ScriptPath: scriptPath,
		Assets: localassets.ProjectIndexerAssets{
			ProjectIndexer:         embeddedProjectIndexer,
			ProjectSemanticIndexer: embeddedProjectSemanticIndexer,
			ProjectRuntimeIndexer:  embeddedProjectRuntimeIndexer,
		},
	})
}
