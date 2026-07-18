package assets

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

// ExtractEmbedded writes an embedded script to the local worker cache and
// returns the absolute extracted path. The cache key includes a content hash, so
// unchanged assets are reused across process starts.
func ExtractEmbedded(name string, content []byte) (string, error) {
	return workerproc.ExtractEmbedded(name, content)
}

// ExtractEvalCoordinator extracts the Eval coordinator script.
func ExtractEvalCoordinator(content []byte) (string, error) {
	return ExtractEmbedded("eval-coordinator", content)
}

// ExtractSourceResolver extracts the embedded source resolver script.
func ExtractSourceResolver(content []byte) (string, error) {
	return ExtractEmbedded("source-resolver", content)
}

// ExtractProjectIndexer extracts the embedded AST/static Project Index worker.
func ExtractProjectIndexer(content []byte) (string, error) {
	return ExtractEmbedded("project-indexer", content)
}

// ExtractProjectSemanticIndexer extracts the embedded semantic Project Index worker.
func ExtractProjectSemanticIndexer(content []byte) (string, error) {
	return ExtractEmbedded("project-semantic-indexer", content)
}

// ExtractProjectRuntimeIndexer extracts the embedded runtime Project Index worker.
func ExtractProjectRuntimeIndexer(content []byte) (string, error) {
	return ExtractEmbedded("project-runtime-indexer", content)
}

// FindNode locates a Node.js executable suitable for running local worker
// scripts and returns an actionable setup hint when Node cannot be found.
func FindNode() (string, error) {
	return findNode(workerproc.FindNodePath)
}

func findNode(resolve func() (string, error)) (string, error) {
	path, err := resolve()
	if err != nil {
		return "", fmt.Errorf("Node.js not found. Install Node.js >= 24 or set CRUX_NODE_PATH: %w", err)
	}
	return path, nil
}
