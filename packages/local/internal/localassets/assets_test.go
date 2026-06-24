package localassets

import (
	"strings"
	"testing"
)

func TestProjectIndexerUsesInjectedWorkerAssets(t *testing.T) {
	worker := NewProjectIndexer(ProjectIndexerOptions{
		ScriptPath: "custom-project-indexer.mjs",
		Assets: ProjectIndexerAssets{
			ProjectIndexer:         []byte("project worker"),
			ProjectSemanticIndexer: []byte("semantic worker"),
			ProjectRuntimeIndexer:  []byte("runtime worker"),
		},
	})
	if worker == nil {
		t.Fatal("NewProjectIndexer returned nil")
	}
	if err := worker.Close(); err != nil {
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
