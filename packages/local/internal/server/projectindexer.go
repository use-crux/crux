package server

import "github.com/use-crux/crux/packages/local/internal/projectindexer"

// NewEmbeddedProjectIndexer creates the local Project Index worker with the
// scripts embedded by the local runtime.
func NewEmbeddedProjectIndexer(scriptPath string) *projectindexer.Worker {
	return projectindexer.New(projectindexer.WorkerOptions{
		ProjectIndexerScript: scriptPath,
		Assets: projectindexer.WorkerAssets{
			ProjectIndexer:         embeddedProjectIndexer,
			ProjectSemanticIndexer: embeddedProjectSemanticIndexer,
			ProjectRuntimeIndexer:  embeddedProjectRuntimeIndexer,
		},
	})
}
