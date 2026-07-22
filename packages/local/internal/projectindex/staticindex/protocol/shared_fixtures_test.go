package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type staticIndexProtocolSharedFixture struct {
	Requests  []json.RawMessage `json:"requests"`
	Responses []json.RawMessage `json:"responses"`
}

func TestSharedStaticIndexProtocolFixturesAreDeclaredByContractManifest(t *testing.T) {
	assertSharedStaticIndexRuntimeManifestFixture(t, "static-index-identity.json")
	assertSharedStaticIndexRuntimeManifestFixture(t, "static-index-protocol.json")
	assertSharedStaticIndexRuntimeManifestFixture(t, "static-index-protocol-cases.json")
	assertSharedStaticIndexRuntimeManifestGoMirror(t)
}

func TestSharedStaticIndexIdentityFixtureMatchesManifest(t *testing.T) {
	var fixture IdentityManifest
	readSharedStaticIndexRuntimeFixture(t, "static-index-identity.json", &fixture)

	if got, want := fixture, StaticIndexIdentityManifest(); got != want {
		t.Fatalf("identity manifest = %+v, want %+v", got, want)
	}
}

func TestSharedStaticIndexProtocolFixtureDecodes(t *testing.T) {
	var fixture staticIndexProtocolSharedFixture
	readSharedStaticIndexRuntimeFixture(t, "static-index-protocol.json", &fixture)

	requestMethods := make([]string, 0, len(fixture.Requests))
	for _, raw := range fixture.Requests {
		method := staticIndexFixtureMethod(t, raw)
		requestMethods = append(requestMethods, method)
		switch method {
		case PrepareMethod:
			var request PrepareRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				t.Fatalf("decode prepare request: %v", err)
			}
			if request.Root != "/repo" || len(request.CallInterests) != 1 {
				t.Fatalf("prepare request = %+v, want shared fixture root and call interest", request)
			}
			if request.Identity.RuleDescriptors.Digest != "sha256:rule-descriptors" {
				t.Fatalf("prepare identity ruleDescriptors = %+v, want shared manifest digest", request.Identity.RuleDescriptors)
			}
		case AnalyzeMethod:
			var request AnalyzeRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				t.Fatalf("decode analyze request: %v", err)
			}
			if !request.Stream || len(request.Files) != 1 {
				t.Fatalf("analyze request = %+v, want streamed file fixture", request)
			}
		case FinalizeMethod:
			var request FinalizeRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				t.Fatalf("decode finalize request: %v", err)
			}
			if len(request.NativeFacts) != 1 || len(request.RelationSpecs) == 0 {
				t.Fatalf("finalize request = %+v, want native facts and relation specs", request)
			}
			if len(request.LintSuppressions) != 1 ||
				request.LintSuppressions[0].Scope != LintSuppressionLine ||
				request.LintSuppressions[0].Reason != "shared fixture reason" {
				t.Fatalf("finalize lint suppressions = %+v, want shared prepared suppression", request.LintSuppressions)
			}
		case CompileMethod:
			var request CompileRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				t.Fatalf("decode compile request: %v", err)
			}
			if !request.Stream || len(request.Plan.CacheMisses) != 1 {
				t.Fatalf("compile request = %+v, want streamed cache-miss fixture", request)
			}
		default:
			t.Fatalf("unexpected request method %q", method)
		}
	}
	if got, want := requestMethods, []string{PrepareMethod, AnalyzeMethod, FinalizeMethod, CompileMethod}; !sameStrings(got, want) {
		t.Fatalf("request methods = %v, want %v", got, want)
	}

	for _, raw := range fixture.Responses {
		switch method := staticIndexFixtureMethod(t, raw); method {
		case PrepareMethod:
			var response PrepareResponse
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatalf("decode prepare response: %v", err)
			}
		case AnalyzeMethod:
			var response AnalyzeResponse
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatalf("decode analyze response: %v", err)
			}
		case FinalizeMethod:
			var response FinalizeResponse
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatalf("decode finalize response: %v", err)
			}
		case CompileMethod:
			var response FinalizeResponse
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatalf("decode compile response: %v", err)
			}
		default:
			t.Fatalf("unexpected response method %q", method)
		}
	}
}

func TestSharedStaticIndexProtocolCaseFixturesDecode(t *testing.T) {
	var fixture struct {
		WorkerError struct {
			ID    uint64 `json:"id"`
			OK    bool   `json:"ok"`
			Error string `json:"error"`
		} `json:"workerError"`
		InvalidRequests            []json.RawMessage `json:"invalidRequests"`
		AnalyzeStreamError         json.RawMessage   `json:"analyzeStreamError"`
		FinalizeStreamError        json.RawMessage   `json:"finalizeStreamError"`
		InvalidAnalyzeStreamEvent  json.RawMessage   `json:"invalidAnalyzeStreamEvent"`
		InvalidFinalizeStreamEvent json.RawMessage   `json:"invalidFinalizeStreamEvent"`
	}
	readSharedStaticIndexRuntimeFixture(t, "static-index-protocol-cases.json", &fixture)

	if err := ValidateWorkerResponse(fixture.WorkerError.ID, fixture.WorkerError.OK, fixture.WorkerError.Error, 11); err == nil || !strings.Contains(err.Error(), "static compiler failed") {
		t.Fatalf("ValidateWorkerResponse error = %v, want fixture message", err)
	}
	if len(fixture.InvalidRequests) != 2 {
		t.Fatalf("invalid requests len = %d, want 2", len(fixture.InvalidRequests))
	}

	analyzeError, err := DecodeAnalyzeStreamEvent(fixture.AnalyzeStreamError)
	if err != nil {
		t.Fatalf("DecodeAnalyzeStreamEvent error = %v", err)
	}
	if analyzeError.OK || AnalyzeStreamError(analyzeError.Error).Error() != "Static Index analyze stream failed: analyze failed" {
		t.Fatalf("analyze stream error = %+v", analyzeError)
	}

	finalizeError, err := DecodeFinalizeStreamEvent(fixture.FinalizeStreamError)
	if err != nil {
		t.Fatalf("DecodeFinalizeStreamEvent error = %v", err)
	}
	if finalizeError.OK || FinalizeStreamError(finalizeError.Error).Error() != "Static Index finalize stream failed: finalize failed" {
		t.Fatalf("finalize stream error = %+v", finalizeError)
	}

	invalidAnalyze, err := DecodeAnalyzeStreamEvent(fixture.InvalidAnalyzeStreamEvent)
	if err != nil {
		t.Fatalf("DecodeAnalyzeStreamEvent invalid fixture error = %v", err)
	}
	if invalidAnalyze.Type != "unknown" {
		t.Fatalf("invalid analyze stream type = %q, want unknown", invalidAnalyze.Type)
	}

	invalidFinalize, err := DecodeFinalizeStreamEvent(fixture.InvalidFinalizeStreamEvent)
	if err != nil {
		t.Fatalf("DecodeFinalizeStreamEvent invalid fixture error = %v", err)
	}
	if invalidFinalize.Type != "event" || len(invalidFinalize.Event) != 0 {
		t.Fatalf("invalid finalize stream event = %+v, want missing event payload", invalidFinalize)
	}
}

func staticIndexFixtureMethod(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var header struct {
		Method string `json:"method"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		t.Fatalf("decode Static Index fixture method: %v", err)
	}
	return header.Method
}

func readSharedStaticIndexRuntimeFixture(t *testing.T, name string, out any) {
	t.Helper()
	path := sharedStaticIndexRuntimeFixturePath(t, name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared fixture %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("decode shared fixture %s: %v", path, err)
	}
}

func sharedStaticIndexRuntimeFixturePath(t *testing.T, name string) string {
	t.Helper()
	return filepath.Join(sharedStaticIndexRuntimeRepoRoot(t), "packages", "indexer", "src", "contracts", "fixtures", name)
}

func assertSharedStaticIndexRuntimeManifestFixture(t *testing.T, name string) {
	t.Helper()
	manifest := readSharedStaticIndexRuntimeContractManifest(t)
	path := filepath.ToSlash(filepath.Join("packages", "indexer", "src", "contracts", "fixtures", name))
	group := sharedStaticIndexRuntimeManifestGroup(t, manifest, "static-index")
	if !containsString(group.Fixtures, path) {
		t.Fatalf("contract manifest static-index fixtures = %v, want %s", group.Fixtures, path)
	}
}

func assertSharedStaticIndexRuntimeManifestGoMirror(t *testing.T) {
	t.Helper()
	manifest := readSharedStaticIndexRuntimeContractManifest(t)
	group := sharedStaticIndexRuntimeManifestGroup(t, manifest, "static-index")
	currentPath := currentSharedStaticIndexRuntimeTestPath(t)
	if !containsString(group.Mirrors.Go, currentPath) {
		t.Fatalf("contract manifest static-index Go mirrors = %v, want %s", group.Mirrors.Go, currentPath)
	}
}

func readSharedStaticIndexRuntimeContractManifest(t *testing.T) contractManifest {
	t.Helper()
	path := filepath.Join(sharedStaticIndexRuntimeRepoRoot(t), "packages", "indexer", "src", "contracts", "contract-manifest.json")
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

func sharedStaticIndexRuntimeManifestGroup(t *testing.T, manifest contractManifest, id string) contractManifestGroup {
	t.Helper()
	for _, group := range manifest.Groups {
		if group.ID == id {
			return group
		}
	}
	t.Fatalf("contract manifest missing group %q", id)
	return contractManifestGroup{}
}

func currentSharedStaticIndexRuntimeTestPath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	relative, err := filepath.Rel(sharedStaticIndexRuntimeRepoRoot(t), file)
	if err != nil {
		t.Fatalf("relative path for %s: %v", file, err)
	}
	return filepath.ToSlash(relative)
}

func sharedStaticIndexRuntimeRepoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", ".."))
}

func sameStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
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
