package server

import (
	"embed"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
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
	return nodeworker.ExtractEmbedded(name, content)
}

// ExtractQualityRunner extracts the embedded quality-runner.mjs to the cache directory.
func ExtractQualityRunner() (string, error) {
	return ExtractEmbedded("quality-runner", embeddedQualityRunner)
}

// ExtractSourceResolver extracts the embedded source-resolver.mjs to the cache directory.
func ExtractSourceResolver() (string, error) {
	return ExtractEmbedded("source-resolver", embeddedSourceResolver)
}

// ExtractProjectIndexer extracts the embedded project-indexer.mjs to the cache directory.
func ExtractProjectIndexer() (string, error) {
	return ExtractEmbedded("project-indexer", embeddedProjectIndexer)
}

// ExtractProjectSemanticIndexer extracts the embedded semantic indexer worker to the cache directory.
func ExtractProjectSemanticIndexer() (string, error) {
	return ExtractEmbedded("project-semantic-indexer", embeddedProjectSemanticIndexer)
}

// ExtractProjectRuntimeIndexer extracts the embedded runtime indexer worker to the cache directory.
func ExtractProjectRuntimeIndexer() (string, error) {
	return ExtractEmbedded("project-runtime-indexer", embeddedProjectRuntimeIndexer)
}

// FindNode locates the node binary, returning its path or an error with
// a user-friendly message.
func FindNode() (string, error) {
	path, err := nodeworker.FindNodePath()
	if err != nil {
		return "", fmt.Errorf("Node.js not found. Install Node.js >= 24 or set CRUX_NODE_PATH: %w", err)
	}
	return path, nil
}

// Unused import guard — embed package must be imported for //go:embed to work.
var _ embed.FS
