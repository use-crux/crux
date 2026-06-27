package assets

import "github.com/use-crux/crux/packages/local/internal/projectindex/workers"

// ProjectIndexerAssets carries the embedded worker scripts used by the local
// Project Index workers.
type ProjectIndexerAssets struct {
	ProjectIndexer         []byte
	ProjectSemanticIndexer []byte
	ProjectRuntimeIndexer  []byte
}

// ProjectIndexerOptions configures the local Project Index worker bundle without
// coupling route or server lifecycle code to embedded worker bytes.
type ProjectIndexerOptions struct {
	ScriptPath                string
	ProjectSemanticScriptPath string
	ProjectRuntimeScriptPath  string
	Assets                    ProjectIndexerAssets
}

// NewProjectIndexer creates the Go-owned Project Index worker bundle from local runtime
// asset bytes. The bundle remains lazy; Node is not started until a phase needs
// a TypeScript-backed worker.
func NewProjectIndexer(options ProjectIndexerOptions) *workers.Bundle {
	return workers.New(workers.BundleOptions{
		ProjectIndexerScript:         options.ScriptPath,
		ProjectSemanticIndexerScript: options.ProjectSemanticScriptPath,
		ProjectRuntimeIndexerScript:  options.ProjectRuntimeScriptPath,
		Assets: workers.BundleAssets{
			ProjectIndexer:         options.Assets.ProjectIndexer,
			ProjectSemanticIndexer: options.Assets.ProjectSemanticIndexer,
			ProjectRuntimeIndexer:  options.Assets.ProjectRuntimeIndexer,
		},
	})
}
