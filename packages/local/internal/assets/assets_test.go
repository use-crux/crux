package assets

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestEmbeddedAssetsAreOwnedByAssetsPackage(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	assetsDir := filepath.Dir(file)
	internalDir := filepath.Dir(assetsDir)

	requiredPaths := []string{
		"embedded_assets.go",
		filepath.Join("embed", "project-indexer.mjs"),
		filepath.Join("embed", "project-semantic-indexer.mjs"),
		filepath.Join("embed", "project-runtime-indexer.mjs"),
		filepath.Join("embed", "runtime-worker.mjs"),
		filepath.Join("embed", "eval-coordinator.mjs"),
		filepath.Join("embed", "source-resolver.mjs"),
		filepath.Join("ui-embed", "index.html"),
	}
	for _, rel := range requiredPaths {
		if _, err := os.Stat(filepath.Join(assetsDir, rel)); err != nil {
			t.Fatalf("assets package is missing %s: %v", rel, err)
		}
	}

	forbiddenServerFiles := []string{
		"embedded.go",
		"project_index_host.go",
		"ui.go",
	}
	for _, name := range forbiddenServerFiles {
		if _, err := os.Stat(filepath.Join(internalDir, "server", name)); err == nil {
			t.Fatalf("server package must not own embedded asset wrapper %s", name)
		} else if !os.IsNotExist(err) {
			t.Fatalf("stat server asset wrapper %s: %v", name, err)
		}
	}

	forbiddenServerDirs := []string{
		filepath.Join("server", "embed"),
		filepath.Join("server", "ui-embed"),
	}
	for _, rel := range forbiddenServerDirs {
		if _, err := os.Stat(filepath.Join(internalDir, rel)); err == nil {
			t.Fatalf("server package must not own generated asset directory %s", rel)
		} else if !os.IsNotExist(err) {
			t.Fatalf("stat server asset directory %s: %v", rel, err)
		}
	}
}

func TestProjectIndexerUsesInjectedBundleAssets(t *testing.T) {
	bundle := NewProjectIndexer(ProjectIndexerOptions{
		ScriptPath: "custom-project-indexer.mjs",
		Assets: ProjectIndexerAssets{
			ProjectIndexer:         []byte("project worker"),
			ProjectSemanticIndexer: []byte("semantic worker"),
			ProjectRuntimeIndexer:  []byte("runtime worker"),
		},
	})
	if bundle == nil {
		t.Fatal("NewProjectIndexer returned nil")
	}
	if err := bundle.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}
}

func TestFindNodeReturnsActionableInstallHint(t *testing.T) {
	_, err := findNode(func() (string, error) {
		return "", errNodeMissingForTest{}
	})
	if err == nil {
		t.Fatal("findNode returned nil error")
	}
	if !strings.Contains(err.Error(), "Install Node.js >= 24 or set CRUX_NODE_PATH") {
		t.Fatalf("error = %q, want actionable Node install hint", err)
	}
}

type errNodeMissingForTest struct{}

func (errNodeMissingForTest) Error() string {
	return "missing node"
}
