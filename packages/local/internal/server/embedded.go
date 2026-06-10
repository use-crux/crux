package server

import (
	"embed"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

//go:embed embed/eval-runner.mjs
var embeddedEvalRunner []byte

//go:embed embed/source-resolver.mjs
var embeddedSourceResolver []byte

//go:embed embed/project-indexer.mjs
var embeddedProjectIndexer []byte

// ExtractEmbedded writes an embedded script to the cache directory.
// The file is version-stamped by content hash — only re-extracted when the
// binary changes. Returns the absolute path to the extracted file.
func ExtractEmbedded(name string, content []byte) (string, error) {
	return nodeworker.ExtractEmbedded(name, content)
}

// ExtractEvalRunner extracts the embedded eval-runner.mjs to the cache directory.
func ExtractEvalRunner() (string, error) {
	return ExtractEmbedded("eval-runner", embeddedEvalRunner)
}

// ExtractSourceResolver extracts the embedded source-resolver.mjs to the cache directory.
func ExtractSourceResolver() (string, error) {
	return ExtractEmbedded("source-resolver", embeddedSourceResolver)
}

// ExtractProjectIndexer extracts the embedded project-indexer.mjs to the cache directory.
func ExtractProjectIndexer() (string, error) {
	return ExtractEmbedded("project-indexer", embeddedProjectIndexer)
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
