package host

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	nodeprocess "github.com/use-crux/crux/packages/local/internal/process/node"
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
	return nodeprocess.FindNodePath()
}

func writeShellScript(tb testing.TB, name string, script string) string {
	tb.Helper()
	if runtime.GOOS == "windows" {
		tb.Skip("shell script subprocess tests require a POSIX shell")
	}
	path := filepath.Join(tb.TempDir(), name)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		tb.Fatalf("write %s: %v", name, err)
	}
	return path
}

func shellPath(tb testing.TB) string {
	tb.Helper()
	if runtime.GOOS == "windows" {
		tb.Skip("shell script subprocess tests require a POSIX shell")
	}
	return "/bin/sh"
}
