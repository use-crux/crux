package server

import (
	"embed"

	"github.com/use-crux/crux/packages/local/internal/localassets"
)

//go:embed embed/quality-runner.mjs
var embeddedQualityRunner []byte

//go:embed embed/source-resolver.mjs
var embeddedSourceResolver []byte

//go:embed embed/project-indexer.mjs
var embeddedProjectIndexer []byte

//go:embed embed/project-semantic-indexer.mjs
var embeddedProjectSemanticIndexer []byte

//go:embed embed/project-runtime-indexer.mjs
var embeddedProjectRuntimeIndexer []byte

// ExtractEmbedded writes an embedded script to the cache directory.
// The file is version-stamped by content hash — only re-extracted when the
// binary changes. Returns the absolute path to the extracted file.
func ExtractEmbedded(name string, content []byte) (string, error) {
	return localassets.ExtractEmbedded(name, content)
}

// ExtractQualityRunner extracts the embedded quality-runner.mjs to the cache directory.
func ExtractQualityRunner() (string, error) {
	return localassets.ExtractQualityRunner(embeddedQualityRunner)
}

// ExtractSourceResolver extracts the embedded source-resolver.mjs to the cache directory.
func ExtractSourceResolver() (string, error) {
	return localassets.ExtractSourceResolver(embeddedSourceResolver)
}

// ExtractProjectIndexer extracts the embedded project-indexer.mjs to the cache directory.
func ExtractProjectIndexer() (string, error) {
	return localassets.ExtractProjectIndexer(embeddedProjectIndexer)
}

// ExtractProjectSemanticIndexer extracts the embedded semantic indexer worker to the cache directory.
func ExtractProjectSemanticIndexer() (string, error) {
	return localassets.ExtractProjectSemanticIndexer(embeddedProjectSemanticIndexer)
}

// ExtractProjectRuntimeIndexer extracts the embedded runtime indexer worker to the cache directory.
func ExtractProjectRuntimeIndexer() (string, error) {
	return localassets.ExtractProjectRuntimeIndexer(embeddedProjectRuntimeIndexer)
}

// FindNode locates the node binary, returning its path or an error with
// a user-friendly message.
func FindNode() (string, error) {
	return localassets.FindNode()
}

// Unused import guard — embed package must be imported for //go:embed to work.
var _ embed.FS
