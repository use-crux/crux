package eventwire

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestSharedWorkerEventFixturesAreDeclaredByContractManifest(t *testing.T) {
	assertSharedWorkerEventManifestFixture(t, "worker-events.json")
	assertSharedWorkerEventManifestFixture(t, "worker-event-cases.json")
	assertSharedWorkerEventManifestGoMirror(t)
}

func TestArtifactErrorPreservesStructuredWorkerCode(t *testing.T) {
	collector := NewProjectIndexArtifactStreamCollector(ProjectIndexArtifactStreamOptions{})
	err := collector.Handle(json.RawMessage(`{
		"protocolVersion":2,
		"type":"artifact:error",
		"transactionId":"error:runRuntimeOperation:runtimeOperation",
		"artifact":"runtimeOperation",
		"error":{"message":"runtime requires its host","code":"RUNTIME_HOST_ONLY","remediation":"generate host handlers","findings":[
			{"code":"RUNTIME_EVAL_INVALID","category":"authored","featureKind":"eval","featureId":"answer","arm":"current","source":"evals/answer.eval.ts","summary":"Eval answer is not ready.","reason":"Eval task must be callable.","remediation":"Pass a callable task and save the file."},
			{"code":"RUNTIME_ARTIFACT_INTERNAL","category":"internal","summary":"Crux could not prepare an artifact.","reason":"Internal consistency check failed."}
		]}
	}`))
	var workerErr *WorkerEventError
	if !errors.As(err, &workerErr) {
		t.Fatalf("error = %T %v, want WorkerEventError", err, err)
	}
	if workerErr.Code != "RUNTIME_HOST_ONLY" || workerErr.Message != "runtime requires its host" {
		t.Fatalf("worker error = %#v, want preserved code and message", workerErr)
	}
	if workerErr.Remediation != "generate host handlers" {
		t.Fatalf("worker error remediation = %q, want typed remediation", workerErr.Remediation)
	}
	if len(workerErr.Findings) != 2 || workerErr.Findings[0].FeatureID != "answer" || workerErr.Findings[1].Category != "internal" {
		t.Fatalf("worker error findings = %#v, want both structured children", workerErr.Findings)
	}
}

func TestArtifactErrorRejectsMalformedFinding(t *testing.T) {
	err := NewProjectIndexArtifactStreamCollector(ProjectIndexArtifactStreamOptions{}).Handle(json.RawMessage(`{
		"protocolVersion":2,
		"type":"artifact:error",
		"transactionId":"error:generateRuntimeArtifacts:runtimeArtifacts",
		"artifact":"runtimeArtifacts",
		"error":{"message":"failed","findings":[{"code":"E_BAD","category":"blame","summary":"bad","reason":"bad"}]}
	}`))
	if err == nil || !strings.Contains(err.Error(), "unknown category") {
		t.Fatalf("error = %v, want strict finding category rejection", err)
	}
}

func TestArtifactErrorRequiresErrorMessage(t *testing.T) {
	for _, raw := range []string{
		`{"protocolVersion":2,"type":"artifact:error","transactionId":"missing-error","artifact":"runtimeArtifacts"}`,
		`{"protocolVersion":2,"type":"artifact:error","transactionId":"empty-message","artifact":"runtimeArtifacts","error":{"message":""}}`,
	} {
		err := NewProjectIndexArtifactStreamCollector(ProjectIndexArtifactStreamOptions{}).Handle(json.RawMessage(raw))
		if err == nil || !strings.Contains(err.Error(), "error.message") {
			t.Fatalf("error = %v, want required error.message rejection", err)
		}
	}
}

func TestSharedWorkerEventFixtureDecodes(t *testing.T) {
	var fixture struct {
		Events []json.RawMessage `json:"events"`
	}
	readSharedWorkerEventFixture(t, "worker-events.json", &fixture)

	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root:             "/repo",
		Producer:         "@use-crux/indexer",
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
		Producer: "@use-crux/indexer",
	}).Handle(fixture.PhaseError); err == nil || !strings.Contains(err.Error(), "static index failed") {
		t.Fatalf("Handle phaseError error = %v, want fixture message", err)
	}

	outOfOrderCollector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root:     "/repo",
		Producer: "@use-crux/indexer",
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
	return filepath.Join(sharedWorkerEventRepoRoot(t), "packages", "indexer", "src", "contracts", "fixtures", name)
}

func assertSharedWorkerEventManifestFixture(t *testing.T, name string) {
	t.Helper()
	manifest := readSharedWorkerEventContractManifest(t)
	path := filepath.ToSlash(filepath.Join("packages", "indexer", "src", "contracts", "fixtures", name))
	group := sharedWorkerEventManifestGroup(t, manifest, "worker-events")
	if !containsString(group.Fixtures, path) {
		t.Fatalf("contract manifest worker-events fixtures = %v, want %s", group.Fixtures, path)
	}
}

func assertSharedWorkerEventManifestGoMirror(t *testing.T) {
	t.Helper()
	manifest := readSharedWorkerEventContractManifest(t)
	group := sharedWorkerEventManifestGroup(t, manifest, "worker-events")
	currentPath := currentSharedWorkerEventTestPath(t)
	if !containsString(group.Mirrors.Go, currentPath) {
		t.Fatalf("contract manifest worker-events Go mirrors = %v, want %s", group.Mirrors.Go, currentPath)
	}
}

func readSharedWorkerEventContractManifest(t *testing.T) contractManifest {
	t.Helper()
	path := filepath.Join(sharedWorkerEventRepoRoot(t), "packages", "indexer", "src", "contracts", "contract-manifest.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read contract manifest %s: %v", path, err)
	}
	var manifest contractManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("decode contract manifest %s: %v", path, err)
	}
	return manifest
}

func sharedWorkerEventManifestGroup(t *testing.T, manifest contractManifest, id string) contractManifestGroup {
	t.Helper()
	for _, group := range manifest.Groups {
		if group.ID == id {
			return group
		}
	}
	t.Fatalf("contract manifest missing group %q", id)
	return contractManifestGroup{}
}

func currentSharedWorkerEventTestPath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	relative, err := filepath.Rel(sharedWorkerEventRepoRoot(t), file)
	if err != nil {
		t.Fatalf("relative path for %s: %v", file, err)
	}
	return filepath.ToSlash(relative)
}

func sharedWorkerEventRepoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", ".."))
}

type contractManifest struct {
	Groups []contractManifestGroup `json:"groups"`
}

type contractManifestGroup struct {
	ID       string   `json:"id"`
	Fixtures []string `json:"fixtures"`
	Mirrors  struct {
		Go []string `json:"go"`
	} `json:"mirrors"`
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
