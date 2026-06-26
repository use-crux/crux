package syntax

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

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
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", ".."))
	return filepath.Join(repoRoot, "packages", "indexer", "contracts", "fixtures", name)
}
