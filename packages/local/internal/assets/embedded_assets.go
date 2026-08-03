package assets

import (
	"embed"
	"log/slog"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
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

//go:embed embed/runtime-worker.mjs
var embeddedRuntimeWorker []byte

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

// ExtractEmbeddedRuntimeWorker extracts the self-hosted Runtime worker script.
func ExtractEmbeddedRuntimeWorker() (string, error) {
	return ExtractEmbedded("runtime-worker", embeddedRuntimeWorker)
}

// EmbeddedSourceResolverScript returns the embedded source resolver worker.
func EmbeddedSourceResolverScript() []byte {
	return embeddedSourceResolver
}

// NewEmbeddedProjectIndexer creates the local Project Index worker bundle with the
// scripts embedded by the local runtime.
func NewEmbeddedProjectIndexer(scriptPath string, processOptions ...workerproc.Option) *workers.Bundle {
	return NewProjectIndexer(ProjectIndexerOptions{
		ScriptPath: scriptPath,
		Assets: ProjectIndexerAssets{
			ProjectIndexer:         embeddedProjectIndexer,
			ProjectSemanticIndexer: embeddedProjectSemanticIndexer,
			ProjectRuntimeIndexer:  embeddedProjectRuntimeIndexer,
		},
		ProcessOptions: processOptions,
	})
}

// EmbeddedUIHandler serves the embedded local devtools UI.
func EmbeddedUIHandler(logger ...*slog.Logger) http.Handler {
	var scopedLogger *slog.Logger
	if len(logger) > 0 {
		scopedLogger = logger[0]
	}
	return UIHandler(UIOptions{
		EmbeddedFS: embeddedUI,
		Logger:     scopedLogger,
	})
}

// Keep the embed package import live for //go:embed declarations.
var _ embed.FS
