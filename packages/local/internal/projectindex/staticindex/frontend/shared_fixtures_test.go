package frontend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestSharedStaticSyntaxFixturesAreDeclaredByContractManifest(t *testing.T) {
	assertSharedStaticSyntaxManifestFixture(t, "static-syntax-records.json")
	assertSharedStaticSyntaxManifestFixture(t, "static-syntax-record-cases.json")
	assertSharedStaticSyntaxManifestGoMirror(t)
}

func TestSharedStaticSyntaxRecordFixtureDecodesFromStreamEvent(t *testing.T) {
	var fixture struct {
		Records []json.RawMessage `json:"records"`
	}
	readSharedStaticSyntaxFixture(t, "static-syntax-records.json", &fixture)
	if len(fixture.Records) != 1 {
		t.Fatalf("records len = %d, want 1", len(fixture.Records))
	}

	rawEvent := json.RawMessage(fmt.Sprintf(`{"id":1,"type":"record","index":0,"record":%s}`, fixture.Records[0]))
	event, err := decodeSyntaxBatchEvent(rawEvent)
	if err != nil {
		t.Fatalf("decode syntax record event: %v", err)
	}
	if event.ID != 1 || event.Type != "record" || event.Index != 0 {
		t.Fatalf("event = %+v, want record event", event)
	}

	var record struct {
		SchemaVersion int    `json:"schemaVersion"`
		File          string `json:"file"`
		Matches       []struct {
			Kind         string `json:"kind"`
			VariableName string `json:"variableName"`
		} `json:"matches"`
		NativeFacts []struct {
			MatchIndex int `json:"matchIndex"`
		} `json:"nativeFacts"`
	}
	if err := json.Unmarshal(event.Record, &record); err != nil {
		t.Fatalf("decode syntax record payload: %v", err)
	}
	if record.SchemaVersion != 1 || record.File != "/repo/src/contract.ts" {
		t.Fatalf("record = %+v, want shared syntax fixture", record)
	}
	if len(record.Matches) != 1 || record.Matches[0].Kind != "call" || record.Matches[0].VariableName != "contractPrompt" {
		t.Fatalf("matches = %+v, want contract prompt call", record.Matches)
	}
	if len(record.NativeFacts) != 1 || record.NativeFacts[0].MatchIndex != 0 {
		t.Fatalf("native facts = %+v, want one match-zero packet", record.NativeFacts)
	}
}

func TestSharedStaticSyntaxRecordCaseFixturesDecode(t *testing.T) {
	var fixture struct {
		Records []json.RawMessage `json:"records"`
	}
	readSharedStaticSyntaxFixture(t, "static-syntax-record-cases.json", &fixture)
	if len(fixture.Records) != 1 {
		t.Fatalf("records len = %d, want 1", len(fixture.Records))
	}

	var record struct {
		File    string `json:"file"`
		Matches []struct {
			Kind         string `json:"kind"`
			VariableName string `json:"variableName"`
			Callee       struct {
				Name            string `json:"name"`
				ModuleSpecifier string `json:"moduleSpecifier"`
			} `json:"callee"`
			ObjectArg struct {
				Properties []struct {
					Name  string `json:"name"`
					Value struct {
						Kind  string `json:"kind"`
						Calls []struct {
							Callee struct {
								Name string `json:"name"`
							} `json:"callee"`
						} `json:"calls"`
					} `json:"value"`
				} `json:"properties"`
			} `json:"objectArg"`
		} `json:"matches"`
		Diagnostics []struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"diagnostics"`
	}
	if err := json.Unmarshal(fixture.Records[0], &record); err != nil {
		t.Fatalf("decode static syntax case record: %v", err)
	}
	if record.File != "/repo/src/agent.ts" || len(record.Matches) != 1 {
		t.Fatalf("record = %+v, want agent constructor fixture", record)
	}
	match := record.Matches[0]
	if match.Kind != "new" || match.VariableName != "agent" || match.Callee.Name != "Agent" || match.Callee.ModuleSpecifier != "@use-crux/core" {
		t.Fatalf("match = %+v, want Agent constructor", match)
	}
	var callbackKind, callbackCallee string
	for _, property := range match.ObjectArg.Properties {
		if property.Name == "instructions" {
			callbackKind = property.Value.Kind
			if len(property.Value.Calls) > 0 {
				callbackCallee = property.Value.Calls[0].Callee.Name
			}
		}
	}
	if callbackKind != "function" || callbackCallee != "writeFile" {
		t.Fatalf("callback = %q/%q, want function/writeFile", callbackKind, callbackCallee)
	}
	if len(record.Diagnostics) != 1 || record.Diagnostics[0].Code != "syntax.recovered" {
		t.Fatalf("diagnostics = %+v, want recovered diagnostic", record.Diagnostics)
	}
}

func readSharedStaticSyntaxFixture(t *testing.T, name string, out any) {
	t.Helper()
	path := sharedStaticSyntaxFixturePath(t, name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared fixture %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("decode shared fixture %s: %v", path, err)
	}
}

func sharedStaticSyntaxFixturePath(t *testing.T, name string) string {
	t.Helper()
	return filepath.Join(sharedStaticSyntaxRepoRoot(t), "packages", "indexer", "contracts", "fixtures", name)
}

func assertSharedStaticSyntaxManifestFixture(t *testing.T, name string) {
	t.Helper()
	manifest := readSharedStaticSyntaxContractManifest(t)
	path := filepath.ToSlash(filepath.Join("packages", "indexer", "contracts", "fixtures", name))
	group := sharedStaticSyntaxManifestGroup(t, manifest, "static-syntax-records")
	if !containsString(group.Fixtures, path) {
		t.Fatalf("contract manifest static-syntax-records fixtures = %v, want %s", group.Fixtures, path)
	}
}

func assertSharedStaticSyntaxManifestGoMirror(t *testing.T) {
	t.Helper()
	manifest := readSharedStaticSyntaxContractManifest(t)
	group := sharedStaticSyntaxManifestGroup(t, manifest, "static-syntax-records")
	currentPath := currentSharedStaticSyntaxTestPath(t)
	if !containsString(group.Mirrors.Go, currentPath) {
		t.Fatalf("contract manifest static-syntax-records Go mirrors = %v, want %s", group.Mirrors.Go, currentPath)
	}
}

func readSharedStaticSyntaxContractManifest(t *testing.T) contractManifest {
	t.Helper()
	path := filepath.Join(sharedStaticSyntaxRepoRoot(t), "packages", "indexer", "contracts", "contract-manifest.json")
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

func sharedStaticSyntaxManifestGroup(t *testing.T, manifest contractManifest, id string) contractManifestGroup {
	t.Helper()
	for _, group := range manifest.Groups {
		if group.ID == id {
			return group
		}
	}
	t.Fatalf("contract manifest missing group %q", id)
	return contractManifestGroup{}
}

func currentSharedStaticSyntaxTestPath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	relative, err := filepath.Rel(sharedStaticSyntaxRepoRoot(t), file)
	if err != nil {
		t.Fatalf("relative path for %s: %v", file, err)
	}
	return filepath.ToSlash(relative)
}

func sharedStaticSyntaxRepoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", ".."))
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
