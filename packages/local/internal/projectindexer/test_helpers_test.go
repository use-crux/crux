package projectindexer

import (
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

func newTestWorker(tb testing.TB) *Worker {
	tb.Helper()
	return New(testWorkerOptions(""))
}

func newTestWorkerWithProjectScript(tb testing.TB, scriptPath string) *Worker {
	tb.Helper()
	return New(testWorkerOptions(scriptPath))
}

func testWorkerOptions(projectScriptPath string) WorkerOptions {
	if projectScriptPath == "" {
		projectScriptPath = testEmbeddedScriptPath("project-indexer")
	}
	return WorkerOptions{
		ProjectIndexerScript:         projectScriptPath,
		ProjectSemanticIndexerScript: testEmbeddedScriptPath("project-semantic-indexer"),
		ProjectRuntimeIndexerScript:  testEmbeddedScriptPath("project-runtime-indexer"),
	}
}

func testEmbeddedScriptPath(name string) string {
	return filepath.Join("..", "server", "embed", name+".mjs")
}

func findNodePath() (string, error) {
	return nodeworker.FindNodePath()
}
