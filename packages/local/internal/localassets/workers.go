package localassets

import "github.com/use-crux/crux/packages/local/internal/indexhost"

// ProjectIndexerAssets carries the embedded worker scripts used by the local
// Project Index host.
type ProjectIndexerAssets struct {
	ProjectIndexer         []byte
	ProjectSemanticIndexer []byte
	ProjectRuntimeIndexer  []byte
}

// ProjectIndexerOptions configures a local Project Index host without
// coupling route or server lifecycle code to embedded worker bytes.
type ProjectIndexerOptions struct {
	ScriptPath                string
	ProjectSemanticScriptPath string
	ProjectRuntimeScriptPath  string
	Assets                    ProjectIndexerAssets
}

// NewProjectIndexer creates the Go-owned Project Index host from local runtime
// asset bytes. The worker remains lazy; Node is not started until a phase needs
// a TypeScript-backed worker.
func NewProjectIndexer(options ProjectIndexerOptions) *indexhost.Worker {
	return indexhost.New(indexhost.WorkerOptions{
		ProjectIndexerScript:         options.ScriptPath,
		ProjectSemanticIndexerScript: options.ProjectSemanticScriptPath,
		ProjectRuntimeIndexerScript:  options.ProjectRuntimeScriptPath,
		Assets: indexhost.WorkerAssets{
			ProjectIndexer:         options.Assets.ProjectIndexer,
			ProjectSemanticIndexer: options.Assets.ProjectSemanticIndexer,
			ProjectRuntimeIndexer:  options.Assets.ProjectRuntimeIndexer,
		},
	})
}
