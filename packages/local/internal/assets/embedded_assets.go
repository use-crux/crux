package assets

import (
	"embed"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/projectindex/workers"
)

//go:embed embed/eval-coordinator.mjs
var embeddedEvalCoordinator []byte

//go:embed embed/source-resolver.mjs
var embeddedSourceResolver []byte

//go:embed embed/project-indexer.mjs
var embeddedProjectIndexer []byte

//go:embed embed/project-semantic-indexer.mjs
var embeddedProjectSemanticIndexer []byte

//go:embed embed/project-runtime-indexer.mjs
var embeddedProjectRuntimeIndexer []byte

//go:embed ui-embed/*
var embeddedUI embed.FS

// ExtractEmbeddedEvalCoordinator extracts the new Eval coordinator script.
func ExtractEmbeddedEvalCoordinator() (string, error) {
	return ExtractEvalCoordinator(embeddedEvalCoordinator)
}

// ExtractEmbeddedSourceResolver extracts the embedded source resolver script.
func ExtractEmbeddedSourceResolver() (string, error) {
	return ExtractSourceResolver(embeddedSourceResolver)
}

// EmbeddedSourceResolverScript returns the embedded source resolver worker.
func EmbeddedSourceResolverScript() []byte {
	return embeddedSourceResolver
}

// NewEmbeddedProjectIndexer creates the local Project Index worker bundle with the
// scripts embedded by the local runtime.
func NewEmbeddedProjectIndexer(scriptPath string) *workers.Bundle {
	return NewProjectIndexer(ProjectIndexerOptions{
		ScriptPath: scriptPath,
		Assets: ProjectIndexerAssets{
			ProjectIndexer:         embeddedProjectIndexer,
			ProjectSemanticIndexer: embeddedProjectSemanticIndexer,
			ProjectRuntimeIndexer:  embeddedProjectRuntimeIndexer,
		},
	})
}

// EmbeddedUIHandler serves the embedded local devtools UI.
func EmbeddedUIHandler() http.Handler {
	return UIHandler(UIOptions{
		EmbeddedFS: embeddedUI,
	})
}

// Keep the embed package import live for //go:embed declarations.
var _ embed.FS
