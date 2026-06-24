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
	return filepath.Join(repoRoot, "packages", "indexer", "indexer", "contracts", "fixtures", name)
}
