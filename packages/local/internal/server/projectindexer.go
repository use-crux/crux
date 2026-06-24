package server

import "github.com/use-crux/crux/packages/local/internal/indexhost"

// NewEmbeddedProjectIndexer creates the local Project Index worker with the
// scripts embedded by the local runtime.
func NewEmbeddedProjectIndexer(scriptPath string) *indexhost.Worker {
	return indexhost.New(indexhost.WorkerOptions{
		ProjectIndexerScript: scriptPath,
		Assets: indexhost.WorkerAssets{
			ProjectIndexer:         embeddedProjectIndexer,
			ProjectSemanticIndexer: embeddedProjectSemanticIndexer,
			ProjectRuntimeIndexer:  embeddedProjectRuntimeIndexer,
		},
	})
}
