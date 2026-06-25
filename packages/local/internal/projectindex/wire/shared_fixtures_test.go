package wire

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

func TestSharedWorkerEventCaseFixturesDecode(t *testing.T) {
	var fixture struct {
		ArtifactDone     json.RawMessage   `json:"artifactDone"`
		ArtifactError    json.RawMessage   `json:"artifactError"`
		PhaseError       json.RawMessage   `json:"phaseError"`
		OutOfOrderEvents []json.RawMessage `json:"outOfOrderEvents"`
	}
	readSharedWorkerEventFixture(t, "worker-event-cases.json", &fixture)

	artifactCollector := NewProjectIndexArtifactStreamCollector(ProjectIndexArtifactStreamOptions{
		Root:     "/repo",
		Artifact: ProjectIndexArtifactStaticSyntaxPlan,
	})
	if err := artifactCollector.Handle(fixture.ArtifactDone); err != nil {
		t.Fatalf("Handle artifactDone error = %v", err)
	}
	payload, err := artifactCollector.Payload()
	if err != nil {
		t.Fatalf("artifact payload error = %v", err)
	}
	if len(payload) == 0 {
		t.Fatal("artifact payload is empty")
	}

	if err := NewProjectIndexArtifactStreamCollector(ProjectIndexArtifactStreamOptions{
		Root:     "/repo",
		Artifact: ProjectIndexArtifactStaticSyntaxPlan,
	}).Handle(fixture.ArtifactError); err == nil || !strings.Contains(err.Error(), "static syntax plan failed") {
		t.Fatalf("Handle artifactError error = %v, want fixture message", err)
	}

	if err := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root:     "/repo",
		Producer: "@crux/indexer",
	}).Handle(fixture.PhaseError); err == nil || !strings.Contains(err.Error(), "static index failed") {
		t.Fatalf("Handle phaseError error = %v, want fixture message", err)
	}

	outOfOrderCollector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root:     "/repo",
		Producer: "@crux/indexer",
	})
	for index, event := range fixture.OutOfOrderEvents {
		err := outOfOrderCollector.Handle(event)
		if index == 0 && err != nil {
			t.Fatalf("Handle out-of-order start error = %v", err)
		}
		if index == 1 && (err == nil || !strings.Contains(err.Error(), "sequence")) {
			t.Fatalf("Handle out-of-order batch error = %v, want sequence error", err)
		}
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
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", ".."))
	return filepath.Join(repoRoot, "packages", "indexer", "contracts", "fixtures", name)
}
