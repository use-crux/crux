package projectindexwire

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSharedWorkerEventFixtureDecodes(t *testing.T) {
	var fixture struct {
		Events []json.RawMessage `json:"events"`
	}
	readSharedWorkerEventFixture(t, "worker-events.json", &fixture)

	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root:             "/repo",
		Producer:         "@crux/indexer",
		MaxFactsPerBatch: 2,
	})
	for _, event := range fixture.Events {
		if err := collector.Handle(event); err != nil {
			t.Fatalf("Handle(%s) error = %v", event, err)
		}
	}

	patches, err := collector.Patches()
	if err != nil {
		t.Fatalf("Patches error = %v", err)
	}
	if len(patches) != 1 {
		t.Fatalf("patches len = %d, want 1", len(patches))
	}
	patch := patches[0]
	if patch.Project.Root != "/repo" || patch.Project.Name != "contract-spine" {
		t.Fatalf("project = %+v, want contract-spine fixture", patch.Project)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:contract-spine" {
		t.Fatalf("definitions = %+v, want prompt:contract-spine", patch.Facts.Definitions)
	}
	if patch.SemanticSourceProfile == nil || patch.SemanticSourceProfile.SourceBytes != 42 {
		t.Fatalf("semantic source profile = %+v, want 42 bytes", patch.SemanticSourceProfile)
	}
}

func readSharedWorkerEventFixture(t *testing.T, name string, out any) {
	t.Helper()
	path := sharedWorkerEventFixturePath(t, name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared fixture %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("decode shared fixture %s: %v", path, err)
	}
}

func sharedWorkerEventFixturePath(t *testing.T, name string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
	return filepath.Join(repoRoot, "packages", "indexer", "indexer", "contracts", "fixtures", name)
}
